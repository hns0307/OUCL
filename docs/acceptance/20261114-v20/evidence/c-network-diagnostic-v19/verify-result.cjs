// Read-only log audit; stdout only. Does not run product/GUI/IPC.
const fs=require('node:fs'),path=require('node:path');let rows=[],issues=[];
try{fs.readFileSync(path.join(__dirname,'window.jsonl'),'utf8').split(/\r?\n/).forEach((line,i)=>{if(line.trim())try{rows.push({...JSON.parse(line),line:i+1});}catch{issues.push(i+1);}});}catch{issues.push('missing-log');}
const target=rows.filter(r=>r.kind==='interception'&&r.endpoint==='version_files');
const created=rows.filter(r=>r.kind==='request-created');
const callbacks=target.map(r=>({line:r.line,interceptionId:r.interceptionId,guards:r.guards,heldRequest:r.heldRequest,latestRequest:r.latestRequest,
  callbackCount:rows.filter(x=>x.kind==='callback-invoked'&&x.interceptionId===r.interceptionId).length}));
const requests=created.map(r=>({request:r.request,createdLine:r.line,events:rows.filter(x=>x.request===r.request&&x.kind!=='interception').map(x=>({line:x.line,kind:x.kind,monoMs:x.monoMs,code:x.code,netToken:x.netToken,category:x.category}))}));
const exits=rows.filter(r=>r.kind==='exit');
const complete=target.length>0&&callbacks.every(r=>r.callbackCount===1)&&exits.some(r=>r.code===0)&&!issues.length;
console.log(JSON.stringify({status:complete?'DIAGNOSTIC_CAPTURED':'PENDING',cancelOutcome:'NOT_EXERCISED',
  firstEarlyCloseCause:'UNKNOWN unless event-specific error evidence and reliable identity independently establish causation; ordering alone is insufficient',
  callbacks,requests,parseIssues:issues.slice(0,5),unexpectedResponses:rows.filter(r=>r.kind==='unexpected-response').length,
  limits:'Immediate rejection is intentional. Candidate request associations are not verified Chromium IDs. No automatic replays.'},null,2));
process.exitCode=complete?0:2;
