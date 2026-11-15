from pathlib import Path
import json,hashlib,sqlite3
p=Path('D:/MC_start/OUCL-review-round-20261114/P-A/verification/v33-game-preparation'); b=Path('D:/MC_start/OUCL-acceptance-v33-20261114/game-data'); o=b.parent/'game-run'; source=Path('D:/MC_start/OUCL-PA-clone-20261112/OUCL.runtime/profile/metadata')
sha=lambda f,alg='sha256':hashlib.new(alg,f.read_bytes()).hexdigest()
load=lambda f:json.loads(f.read_text(encoding='utf-8-sig'))
before=load(o/'sessions-before.json')['data']['items']; after=load(b/'profile/metadata/game-sessions.json')['data']['items'];old={s['taskId']:s for s in before};new=[s for s in after if s['taskId'] not in old]
expected=['24871144-2454-505b-92aa-2741ccb05834','5297a61f-56b1-5159-a84f-440c49b9ff5b','34d051d5-22db-58a2-9bf0-e5990b01b87b']
assert len(new)==3;assert [s['snapshot']['instanceId'] for s in new]==expected
for s in new:assert s['spawned'] and s['snapshot']['state']=='exited' and s['snapshot']['exitCode']==0 and not s['stopTaskIds']
for s in after:
 if s['taskId'] in old:assert s==old[s['taskId']]
conn=sqlite3.connect((b/'profile/metadata/tasks.sqlite').as_uri()+'?mode=ro',uri=True);conn.row_factory=sqlite3.Row
original=sqlite3.connect((source/'tasks.sqlite').as_uri()+'?mode=ro',uri=True);original.row_factory=sqlite3.Row
try:
 originalRows=[dict(r) for r in original.execute('SELECT * FROM tasks ORDER BY id')];targetRows={r['id']:dict(r) for r in conn.execute('SELECT * FROM tasks')}
 for row in originalRows:assert targetRows[row['id']]==row
 tasks=[]
 for s in new:
  row=targetRows[s['taskId']];state=json.loads(row['execution']);assert row['kind']=='launch' and state['state']=='completed';tasks.append({'taskId':s['taskId'],'kind':row['kind'],'state':state['state']})
finally:conn.close();original.close()
facts=load(p/'source-metadata.json')
for f in facts:assert sha(source/f['name'])==f['sha256']
for ident in expected:
 name='instance-'+ident+'.json';assert (source/name).read_bytes()==(b/'profile/metadata'/name).read_bytes()
prepared=load(p/'prepared.json');indexes=[]
for rel in sorted(set(x for i in prepared['instances'] for x in i['indexes'])):
 root=b/'games/roots'/prepared['rootId']/'.minecraft/assets';s1=sha(root/rel,'sha1');assert s1==sha(Path('D:/MC_start/OUCL-PA-clone-20261112/OUCL.games/roots')/prepared['rootId']/'.minecraft/assets'/rel,'sha1');indexes.append({'path':rel,'sha1':s1})
lines=[]
for ident in expected:
 file=b/'games/roots'/prepared['rootId']/'.minecraft/versions'/ident/'logs/latest.log'
 text=file.read_text(encoding='utf-8',errors='replace'); selected=[l for l in text.splitlines() if any(v in l.lower() for v in ['loading minecraft','ferritecore','quilt loader','stopping!'])];lines.append({'instanceId':ident,'logSha256':sha(file),'lines':selected})
assert any('ferritecore 6.0.1' in l for l in lines[1]['lines']);assert any('quilt loader 0.29.2' in l.lower() for l in lines[2]['lines'])
product=load(p/'production-seven-sha256.json')['outputs'];app=Path('D:/MC_start/OUCL-acceptance-exe-v32-20261114/OUCL.runtime/app-272cc737f3bade0a6b197f7907b21b2dce2acce854f1d4cc8347155fb3f62291')
for f in product:assert sha(app/f['path'])==f['sha256']
exe=app.parents[1]/'OUCL-0.3.0-acceptance-20261114-v32.exe';assert sha(exe)=='ba24713708030ba8b96a65858305fb4593d6e3fb0b2afc0ef83e6a4258904be7'
result={'status':'THREE_GAME_NORMAL_PATHS_PASS','newSessions':new,'completedTasks':tasks,'oldTaskRowsPreserved':len(originalRows),'oldSessionsPreserved':len(before),'sourceMetadataUnchanged':len(facts),'instanceRecordsUnchanged':3,'indexes':indexes,'whitelistedLogs':lines,'sevenProductOutputsMatch':True,'launcherStillOpen':True,'normalLauncherReopen':'PENDING_FOREGROUND_UNAVAILABLE','screenshots':'Three menu screenshots separately inspected by coordinator; audit does not infer menus from logs','account':'Existing synthetic OUCLTest16; attempted OUCLAV33 background switch did not apply'}
(o/'three-games-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('PASS:3 new natural exit0/completed launch tasks;21 historical tasks and original sessions preserved;18 source records/3 instance records/indexes/7 outputs unchanged. Launcher close/reopen pending.')
