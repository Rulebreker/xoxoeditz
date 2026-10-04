#!/usr/bin/env node
import { main } from '../src/cli/index.js';

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((e) => {
  console.error(`xoxo: unexpected error: ${e.stack || e.message}`);
  process.exitCode = 2;
});
