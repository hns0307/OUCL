const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=(bytes,algorithm='sha256')=>crypto.createHash(algorithm).update(bytes).digest('hex');
exports.prepare=(s,base)=>{
  const cases=[],whitelist={};
  for(const name of ['nested-multi','exact-platform-pin']){
    const evidenceRoot='D:/MC_start/OUCL/docs/acceptance/20261113-v16/evidence';
    const evidence=JSON.parse(fs.readFileSync(path.join(evidenceRoot,'attempt2-'+name,'evidence.json'),'utf8'));
    const response=JSON.parse(fs.readFileSync(path.join(evidenceRoot,'attempt2-'+name,'synthetic-response.json'),'utf8'));
    const fabric=value=>JSON.stringify({schemaVersion:1,version:'1.0.0',...value});
    const nested=name==='nested-multi';
    const entries=[['fabric.mod.json',fabric({id:'parent_mod',provides:['parent_alias'],...(nested?{jars:[{file:'META-INF/jars/private-child.jar'}]}:{})})],
      ['quilt.mod.json',JSON.stringify({schema_version:1,quilt_loader:{id:'quilt_parent',group:'org.oucl.fixture',version:'1.0.0'}})]];
    if(nested)entries.push(['META-INF/jars/private-child.jar',s.modZip([['fabric.mod.json',fabric({id:'nested_mod'})]])]);
    const jars={'provider.jar':s.modZip(entries),'dependent.jar':s.modZip([['fabric.mod.json',fabric({id:'dependent_mod',depends:{parent_alias:'*',...(nested?{nested_mod:'*'}:{})}})]])};
    for(const [filename,bytes]of Object.entries(jars))for(const field of ['sha1','sha256','sha512'])assert.equal(hash(bytes,field),evidence.manifest[filename][field]);
    const hashes=Object.keys(jars).sort().map(filename=>hash(jars[filename],'sha512'));
    const requestBody=JSON.stringify({hashes,algorithm:'sha512'});whitelist[hash(requestBody)]=response;
    const location=path.join(base,'fixtures',name);fs.mkdirSync(location,{recursive:true});
    for(const [filename,bytes]of Object.entries(jars))fs.writeFileSync(path.join(location,filename),bytes);
    fs.writeFileSync(path.join(location,'synthetic-response.json'),JSON.stringify(response,null,2));
    cases.push({name,location,manifest:evidence.manifest,requestBodySHA256:hash(requestBody)});
  }
  fs.writeFileSync(path.join(base,'whitelist.json'),JSON.stringify(whitelist,null,2));return cases;
};
exports.fetch=(s,base)=>s.createDesktopFetch(require('./transport.cjs').createFactory(()=>JSON.parse(fs.readFileSync(path.join(base,'whitelist.json'),'utf8'))));
