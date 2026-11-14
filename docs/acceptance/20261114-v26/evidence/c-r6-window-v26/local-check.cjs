const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const s=require('./services.cjs'),{createFactory}=require('./transport.cjs');
const table=JSON.parse(fs.readFileSync(path.join(__dirname,'whitelist.json'),'utf8'));
(async()=>{
  const events=[],fetch=s.createDesktopFetch(createFactory(()=>table,event=>events.push(event)));
  for(const entry of Object.values(table)){
    const hashes=Object.keys(entry.body).sort((a,b)=>entry.body[a].files[0].filename.localeCompare(entry.body[b].files[0].filename));
    const result=await new s.ModrinthModClient(fetch).byHashes(hashes);
    assert.equal(result.size,2);
  }
  await assert.rejects(fetch('https://api.modrinth.com/v2/version_files',{method:'POST',body:'{"hashes":[],"algorithm":"sha512"}'}));
  await assert.rejects(fetch('https://api.modrinth.com/v2/other',{method:'POST',body:'{}'}));
  assert.equal(events.filter(event=>event.matched).length,2);assert.equal(events.filter(event=>!event.matched).length,2);
  const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'seed.json'),'utf8'));
  assert.equal(seed.instances[0].report.state,'satisfied');assert.equal(seed.instances[1].report.localState,'satisfied');
  assert.ok(seed.instances[1].report.issues.some(issue=>issue.code==='PLATFORM_PIN_MISMATCH'));
  const result={status:'PASS',matchedRequests:2,rejectedRequests:2,formalGlobalReopen:'4 completed tasks (prepare assertions)',scope:'Production desktop-fetch/client with approved synthetic request factory; no Electron/public network'};
  fs.writeFileSync(path.join(__dirname,'local-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
