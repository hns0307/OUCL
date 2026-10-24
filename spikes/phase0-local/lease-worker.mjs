import { acquireLease, releaseLease } from './lease.mjs';

const [root, mode] = process.argv.slice(2);
const lease = await acquireLease(root, mode === 'empty');
process.on('message', async message => {
  if (message === 'release' && lease.status === 'acquired') {
    const released = await releaseLease(root, lease.token);
    process.send({ status: 'released', released }, () => { process.disconnect(); });
  } else if (message === 'exit') process.disconnect();
});
process.send(lease);
