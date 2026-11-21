import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
for(const operation of ['link','symlink']) {
 const original = fs[operation];
 fs[operation] = async (...args) => { try {return await original(...args);} catch(error) {console.error('BASELINE_NATIVE_FAILURE', JSON.stringify({operation, code:error.code, syscall:error.syscall, path:error.path, dest:error.dest}));throw error;} };
}
syncBuiltinESMExports();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {try{return await originalFetch(...args);}catch(error){console.error('BASELINE_FETCH_FAILURE',JSON.stringify({name:error.name,message:error.message,cause:error.cause&&{code:error.cause.code,message:error.cause.message,syscall:error.cause.syscall,address:error.cause.address,port:error.cause.port}}));throw error;}};
