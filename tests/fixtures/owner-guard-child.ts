import { OwnerGuard } from '../../src/services/storage/owner-guard.js';

const directory = process.argv[2];
if (!directory) throw new Error('missing test directory');
await OwnerGuard.acquire(directory);
process.stdout.write('ready\n');
setInterval(() => {}, 1000);
