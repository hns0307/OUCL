const { app } = require('electron');
const path = require('node:path');
// Isolate all Electron userData from the player's launcher profile.
app.setPath('userData', path.join(__dirname, 'evidence', '20261111', 'e3-profile'));
require('./evidence/20261111/e3-build/main/index.cjs');
