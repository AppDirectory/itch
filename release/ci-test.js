#!/usr/bin/env node

// compile typescript code and run unit tests

const $ = require('./common')

async function main () {
  await $.showVersions(['yarn']);

  $(await $.yarn('install'));

  process.env.ELECTRON_ENABLE_LOGGING = '1';

  $(await $.yarn('run compile'));
  if (process.platform === "linux") {
    $(await $.sh('xvfb-run yarn test'));
  } else {
    $(await $.sh('yarn test'));
  }
}

main();
