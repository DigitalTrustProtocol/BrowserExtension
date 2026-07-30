import { reloadAttentionXExtension } from './lib/extension-dev-browser.mjs';

const result = await reloadAttentionXExtension();
if (result.skipped) {
  console.log(`[reload-extension] skipped: ${result.reason}`);
  process.exit(0);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
