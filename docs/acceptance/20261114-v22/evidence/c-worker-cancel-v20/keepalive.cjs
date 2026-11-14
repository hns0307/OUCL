// Loaded only in the explicitly selected genuine mod-archive worker. Never posts a protocol message.
const {workerData,threadId}=require('node:worker_threads');
const fs=require('node:fs');
if(workerData?.kind!=='mod-archive'||!process.env.OUCL_TEST_KEEPALIVE_LOG)throw Error('INVALID_TEST_KEEPALIVE_TARGET');
fs.appendFileSync(process.env.OUCL_TEST_KEEPALIVE_LOG,JSON.stringify({kind:'keepalive-loaded',threadId,time:new Date().toISOString(),monoMs:performance.now()})+'\n');
setInterval(()=>{},1000); // Deliberately referenced: original Reader must terminate and await actual exit.
