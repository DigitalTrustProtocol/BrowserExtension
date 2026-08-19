import { main } from './lib/ax-cli.mjs';

const extra = process.argv.slice(2);
process.exit(await main(['inspect', ...extra]));
