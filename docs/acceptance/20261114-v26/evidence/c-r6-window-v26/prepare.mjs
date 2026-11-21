import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
let code=await readFile(path.resolve(base,'../v5-global/prepare.mjs'),'utf8');
function replace(from,to){if(!code.includes(from))throw Error('TEMPLATE_CHANGED:'+from.slice(0,50));code=code.replace(from,to);}
replace("StorageClient: 'services/workers/storage-client',", "createDesktopFetch: 'main/network', LoaderInstallMetadataService: 'services/loaders/install-metadata', parseLoaderProfile: 'core/loaders/metadata', StorageClient: 'services/workers/storage-client',");
replace("const sha1 = bytes", "const fixture=createRequire(import.meta.url)('./fixtures.cjs'); const cases=fixture.prepare(s,base);\nconst sha1 = bytes");
replace("const createInstaller = storage => new s.InstallerService(storage, worker,\n  new s.InstallMetadataService(new s.CatalogService(reader, storage), reader), undefined, undefined, undefined, undefined, transport);", `const loaderValue={id:'fabric-loader-0.16.14-1.20.1',inheritsFrom:'1.20.1',mainClass:'net.fabricmc.loader.impl.launch.knot.KnotClient',arguments:{game:[],jvm:[]},libraries:[{name:'net.fabricmc:fabric-loader:0.16.14',url:'https://maven.fabricmc.net/'}]};
const loaderBody=JSON.stringify(loaderValue),loaderBytes=Buffer.from('synthetic non executable loader');
const loaderUrl='https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar';
const createInstaller=storage=>{const vanilla=new s.InstallMetadataService(new s.CatalogService(reader,storage),reader);
 const loader=new s.LoaderInstallMetadataService(vanilla,{profile:async()=>({profile:s.parseLoaderProfile('fabric','1.20.1','0.16.14',loaderValue),body:loaderBody,evidence:{sourceUrl:'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.16.14/profile/json',sha256:createHash('sha256').update(loaderBody).digest('hex')}})},
 {plan:async()=>({totalBytes:loaderBytes.length,libraries:[{path:'net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar',spec:{url:loaderUrl,expected:{algorithm:'sha1',digest:sha1(loaderBytes),size:loaderBytes.length,provenanceId:'loader:fabric:'+sha1(loaderBytes)},anchor:{kind:'loader-maven',algorithm:'sha256',digest:'f'.repeat(64)}}}]})});
 return new s.InstallerService(storage,worker,vanilla,loader,undefined,undefined,undefined,async(input,options)=>String(input)===loaderUrl?new Response(new Uint8Array(loaderBytes),{headers:{'content-length':String(loaderBytes.length)}}):transport(input,options));};`);
replace("new s.ModrinthModClient(async () => { throw new TypeError('CONTROLLED_OFFLINE'); })", "new s.ModrinthModClient(fixture.fetch(s,base))");
replace("`GLOBAL-${suffix} Synthetic Installed Vanilla`", "`R6-${suffix} Synthetic Fabric`");
replace("installer.create(randomUUID(), { rootId, mcVersionId: '1.20.1', displayName, isolation: 'on' })", "installer.createLoader(randomUUID(), { rootId, mcVersionId: '1.20.1', displayName, isolation: 'on',loader:{kind:'fabric',version:'0.16.14'} })");
replace("const filename = `global-${suffix.toLowerCase()}-synthetic.jar`;", "const caseInfo=cases[suffix==='A'?0:1]; const filename='provider.jar';");
const start=code.indexOf('    await writeFile(path.join(modsDirectory, filename), s.modZip('),end=code.indexOf('    instances.push(',start);
if(start<0||end<0)throw Error('TEMPLATE_JAR_CHANGED');
code=code.slice(0,start)+"    for(const jar of ['provider.jar','dependent.jar'])await writeFile(path.join(modsDirectory,jar),await readFile(path.join(caseInfo.location,jar)));\n"+code.slice(end);
replace("profile, games, rootId, instances,", "profile, games, rootId, cases, instances,");
await writeFile(path.join(base,'prepare-generated.mjs'),code);
await import(pathToFileURL(path.join(base,'prepare-generated.mjs')).href);
