import { inspectAttentionX } from './lib/extension-dev-browser.mjs';

const includeApps = !process.argv.includes('--x-only');
const result = await inspectAttentionX({ includeApps });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
