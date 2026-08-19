#!/usr/bin/env node
import { VERSION } from './lib/ax-version.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === '-v' || args[0] === '-V' || args[0] === '--version')) {
  console.log(VERSION);
  process.exit(0);
}

const { main } = await import('./lib/ax-cli.mjs');
process.exit(await main(args));
