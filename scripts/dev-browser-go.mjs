import fs from 'node:fs';
import {
  DIST_PATH,
  ensureDebugChrome,
  reloadAttentionXExtension,
} from './lib/extension-dev-browser.mjs';

if (!fs.existsSync(DIST_PATH)) {
  console.error(`dist/ not found at ${DIST_PATH}. Run npm run build first.`);
  process.exit(1);
}

const chromeResult = await ensureDebugChrome();
if (!chromeResult.ok) {
  console.error(chromeResult.reason);
  process.exit(1);
}

const result = await reloadAttentionXExtension();
console.log(JSON.stringify({ ...result, chromeResult }, null, 2));
process.exit(result.ok ? 0 : 1);
