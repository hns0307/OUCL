"""P-E independent research oracle; no product imports, IO writes, or extraction.

Python zipfile is only a fixture reader, not the proposed production ZIP worker.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import stat
import struct
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parent
LIMITS = dict(archive=16 * 1024**2, entries=1024, expanded=64 * 1024**2,
              entry=8 * 1024**2, index=1024**2, ratio=100, files=16,
              downloads=64 * 1024**2)
RESERVED = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)", re.I)


class Rejected(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def path_key(name):
    """Reject Windows aliases rather than normalizing them into accepted paths."""
    require(isinstance(name, str) and 0 < len(name.encode('utf-8')) <= 240, 'PATH')
    require(name == unicodedata.normalize('NFC', name), 'PATH')
    require(not any(ord(c) < 32 or c in '\\:*?"<>|' for c in name), 'PATH')
    # First slice deliberately accepts ASCII only; reject exotic Windows aliases.
    require(name.isascii(), 'PATH')
    parts = name.split('/')
    require(len(parts) <= 16, 'PATH')
    require(all(p and p not in ('.', '..') and not p.endswith((' ', '.'))
                and not RESERVED.match(p) for p in parts), 'PATH')
    return name.lower()


def no_collisions(names):
    keys = sorted(path_key(name) for name in names)
    require(len(keys) == len(set(keys)), 'PATH_COLLISION')
    for left, right in zip(keys, keys[1:]):
        require(not right.startswith(left + '/'), 'PATH_COLLISION')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'INDEX_DUPLICATE_KEY')
        result[key] = value
    return result


def exact(value, required, optional=()):
    require(type(value) is dict and set(required) <= value.keys()
            and value.keys() <= set(required) | set(optional), 'INDEX_SCHEMA')


def index_plan(value, official):
    exact(value, ('formatVersion', 'game', 'versionId', 'name', 'files', 'dependencies'), ('summary',))
    require(type(value['formatVersion']) is int and value['formatVersion'] == 1
            and value['game'] == 'minecraft', 'INDEX_UNSUPPORTED')
    for key in ('name', 'versionId'):
        require(type(value[key]) is str and 0 < len(value[key]) <= 160
                and all(ord(c) >= 32 for c in value[key]), 'INDEX_SCHEMA')
    if 'summary' in value:
        require(type(value['summary']) is str and len(value['summary']) <= 1024, 'INDEX_SCHEMA')
    require(value['dependencies'] == {'minecraft': '1.20.1', 'forge': '47.4.28'}, 'ENV_UNSUPPORTED')
    files = value['files']
    require(type(files) is list and 0 < len(files) <= LIMITS['files'], 'FILES_LIMIT')
    no_collisions([item.get('path', '') if type(item) is dict else '' for item in files])
    total = 0
    result = []
    for item in files:
        exact(item, ('path', 'hashes', 'downloads', 'fileSize'), ('env',))
        require(item['path'] == 'mods/ferritecore-6.0.1-forge.jar', 'FILE_UNSUPPORTED')
        exact(item['hashes'], ('sha1', 'sha512'))
        require(type(item['fileSize']) is int and 0 < item['fileSize'] <= 64 * 1024**2, 'FILE_SIZE')
        total += item['fileSize']
        require(total <= LIMITS['downloads'], 'DOWNLOAD_LIMIT')
        for key, length in (('sha1', 40), ('sha512', 128)):
            require(type(item['hashes'][key]) is str and
                    re.fullmatch('[0-9a-f]{' + str(length) + '}', item['hashes'][key]), 'HASH')
        if 'env' in item:
            exact(item['env'], ('client', 'server'))
            require(all(x in ('required', 'optional', 'unsupported') for x in item['env'].values()), 'ENV_SCHEMA')
        # E1 fixed sample intentionally has no optional selection or manual files.
        require(item.get('env', {}).get('client', 'required') == 'required', 'ENV_UNSUPPORTED')
        require(item['hashes'] == official['hashes'] and item['fileSize'] == official['size']
                and item['downloads'] == [official['url']], 'SOURCE_MISMATCH')
        result.append(dict(path=item['path'], sha512=item['hashes']['sha512'], size=item['fileSize']))
    return result


def check_budget(entries, actual_sizes):
    """Independent archive limits include overwritten and ignored content."""
    require(len(entries) <= LIMITS['entries'], 'ENTRY_LIMIT')
    expanded = compressed = 0
    for entry, actual in zip(entries, actual_sizes, strict=True):
        require(actual <= LIMITS['entry'], 'ENTRY_BYTES')
        expanded += actual
        compressed += entry
        require(actual <= max(entry, 1) * LIMITS['ratio'], 'RATIO')
    require(expanded <= LIMITS['expanded'], 'EXPANDED_LIMIT')
    require(expanded <= max(compressed, 1) * LIMITS['ratio'], 'RATIO')


def preview(blob, official):
    require(len(blob) <= LIMITS['archive'], 'ARCHIVE_LIMIT')
    contents, sizes, compressed = {}, [], []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            entries = archive.infolist()
            require(len(entries) <= LIMITS['entries'], 'ENTRY_LIMIT')
            names = []
            for entry in entries:
                require(entry.filename == entry.orig_filename, 'PATH')
                name = entry.filename[:-1] if entry.is_dir() else entry.filename
                path_key(name)
                names.append(name)
                mode = entry.external_attr >> 16
                require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), 'SPECIAL_FILE')
                require(not entry.flag_bits & 1 and entry.compress_type in (0, 8), 'ZIP_UNSUPPORTED')
                require(entry.file_size <= LIMITS['entry'], 'ENTRY_BYTES')
                # Bounded actual read. zipfile also checks its own CRC/local-header rules.
                with archive.open(entry) as source:
                    body = source.read(LIMITS['entry'] + 1)
                sizes.append(len(body)); compressed.append(entry.compress_size)
                check_budget(compressed, sizes)
                if not entry.is_dir():
                    contents[entry.filename] = body
            no_collisions(names)
    except (zipfile.BadZipFile, RuntimeError, EOFError, NotImplementedError) as error:
        raise Rejected('ZIP_INVALID') from error
    require('modrinth.index.json' in contents, 'INDEX_MISSING')
    raw = contents.pop('modrinth.index.json')
    require(len(raw) <= LIMITS['index'], 'INDEX_LIMIT')
    try:
        index = json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=unique_object)
    except (UnicodeError, ValueError) as error:
        raise Rejected('INDEX_INVALID') from error
    downloads = index_plan(index, official)
    layers = {'overrides': {}, 'client-overrides': {}}
    ignored = []
    for name, body in contents.items():
        layer, _, path = name.partition('/')
        if layer == 'server-overrides':
            ignored.append(name)
            continue
        require(layer in layers and path == 'config/oucl-pe-smoke.properties', 'OVERRIDE_UNSUPPORTED')
        layers[layer][path] = body
    output, replacements = {}, []
    for layer, items in layers.items():
        for path, body in items.items():
            if path in output:
                replacements.append(dict(path=path, before=output[path]['sha256'],
                                         after=hashlib.sha256(body).hexdigest(), winner=layer))
            output[path] = dict(sha256=hashlib.sha256(body).hexdigest(), size=len(body), layer=layer)
    no_collisions([row['path'] for row in downloads] + list(output))
    return dict(scope='research-only', executable=False, archiveSha256=hashlib.sha256(blob).hexdigest(),
                downloads=downloads, output=output, replacements=replacements,
                ignored=ignored, expandedBytes=sum(sizes), entries=len(sizes))


def make_zip(index, extras=(), compression=zipfile.ZIP_STORED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=compression) as archive:
        archive.writestr('modrinth.index.json', index if isinstance(index, bytes) else json.dumps(index).encode())
        for name, body, mode in extras:
            item = zipfile.ZipInfo(name)
            item.external_attr = mode << 16
            item.compress_type = compression
            archive.writestr(item, body)
    return buffer.getvalue()


def run():
    index = json.loads((ROOT / 'sample/modrinth.index.json').read_text('utf-8'))
    official = json.loads((ROOT / 'evidence/20261110/version.json').read_text('utf-8'))['files'][0]
    rows = []

    def case(name, callback, expected=None):
        try:
            callback()
            actual = 'ACCEPT'
        except Rejected as error:
            actual = str(error)
        passed = actual == (expected or 'ACCEPT')
        rows.append(dict(name=name, expected=expected or 'ACCEPT', actual=actual, passed=passed))

    sample = (ROOT / 'sample/OUCL-PE-Forge-Smoke-1.0.0.mrpack').read_bytes()
    plan = preview(sample, official)
    case('sample archive', lambda: preview(sample, official))
    case('client layer wins exact digest', lambda: require(plan['output']['config/oucl-pe-smoke.properties']['sha256']
         == hashlib.sha256(b'sample=client\n').hexdigest() and len(plan['replacements']) == 1, 'BAD_WINNER'))
    for name in ('../x','/x','C:/x','//host/x','a\\b','a:b','a/./b','a/../b','a//b',
                 'CON','nul.txt','COM1.log','LPT9','config/x.','config/x ','a/\x00b','a/\nb',
                 'a/<x','a/\u00e9','/','a/'*16+'x'):
        case('reject path ' + repr(name), lambda n=name: path_key(n), 'PATH')
    for names in (['config/A','config/a'], ['a','a/b'], ['a/b','a/b/c'], ['x','x']):
        case('collision ' + repr(names), lambda n=names: no_collisions(n), 'PATH_COLLISION')
    for name in ('saves/world.dat','overrides/mods/x.jar','overrides/options.txt','config/x'):
        case('unsupported override ' + name, lambda n=name: preview(make_zip(index, [(n,b'x',stat.S_IFREG)]), official), 'OVERRIDE_UNSUPPORTED')
    case('symlink even in ignored server layer', lambda: preview(make_zip(index,
         [('server-overrides/config/link',b'../outside',stat.S_IFLNK)]), official), 'SPECIAL_FILE')
    case('ignored bytes still bomb budget', lambda: preview(make_zip(index,
         [('server-overrides/config/large',b'x'*100000,stat.S_IFREG)],zipfile.ZIP_DEFLATED), official), 'RATIO')
    case('duplicate JSON key', lambda: preview(make_zip(b'{"formatVersion":1,"formatVersion":1}'), official), 'INDEX_DUPLICATE_KEY')
    case('malformed UTF8', lambda: preview(make_zip(b'\xff'), official), 'INDEX_INVALID')
    for field, value, error in [('fileSize',True,'FILE_SIZE'), ('fileSize',0,'FILE_SIZE'),
                               ('downloads',['https://example.org/x.jar'],'SOURCE_MISMATCH'),
                               ('hashes',{'sha1':'0'*40,'sha512':'0'*128},'SOURCE_MISMATCH')]:
        changed = copy.deepcopy(index); changed['files'][0][field] = value
        case('index ' + field + repr(value), lambda c=changed: preview(make_zip(c),official),error)
    changed = copy.deepcopy(index); changed['dependencies']['fabric-loader']='0.16.14'
    case('multiple loaders',lambda: preview(make_zip(changed), official),'ENV_UNSUPPORTED')
    changed2 = copy.deepcopy(index); changed2['files'][0]['env']['client']='optional'
    case('optional unsupported in fixed sample',lambda: preview(make_zip(changed2), official),'ENV_UNSUPPORTED')
    changed3 = copy.deepcopy(index); changed3['files'] *= 17
    case('17 index files do not split',lambda: preview(make_zip(changed3), official),'FILES_LIMIT')
    for count in (1023,1024,1025):
        case('archive entries '+str(count),lambda n=count: check_budget([1]*n,[1]*n),
             'ENTRY_LIMIT' if count>1024 else None)
    for count in (63,64,65):
        case('expanded MiB '+str(count),lambda n=count: check_budget([1024**2]*n,[1024**2]*n),
             'EXPANDED_LIMIT' if count>64 else None)
    for size in (8*1024**2,8*1024**2+1):
        case('entry bytes '+str(size),lambda n=size: check_budget([n],[n]),'ENTRY_BYTES' if size>8*1024**2 else None)
    # Stored sample: corrupt a content byte; local and central CRC remain unchanged.
    corrupt = bytearray(sample)
    with zipfile.ZipFile(io.BytesIO(sample)) as archive:
        entry = archive.getinfo('overrides/config/oucl-pe-smoke.properties')
        offset = entry.header_offset
        name_len, extra_len = struct.unpack_from('<HH',corrupt,offset+26)
        corrupt[offset+30+name_len+extra_len] ^= 1
    case('bad CRC',lambda: preview(bytes(corrupt),official),'ZIP_INVALID')
    report = dict(scope='independent oracle, not product worker',passed=sum(row['passed'] for row in rows),
                  failed=sum(not row['passed'] for row in rows),cases=rows,preview=plan)
    output = ROOT / 'evidence/20261110/e1-preview-results.json'
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('scope','passed','failed')},ensure_ascii=False))
    if report['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    run()
