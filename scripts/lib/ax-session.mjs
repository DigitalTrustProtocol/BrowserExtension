import fs from 'node:fs';
import path from 'node:path';
import {
  CDP_URL,
  USER_DATA_DIR,
  connectBrowser,
  findAttentionXId,
  focusXTab,
  isCdpAvailable,
  isXUrl,
  releaseCdpBrowser,
} from './extension-dev-browser.mjs';
import { parseRef } from './ax-refs.mjs';

export { parseRef, formatRef } from './ax-refs.mjs';

const SESSION_PATH = path.join(USER_DATA_DIR, 'ax-session.json');

export { CDP_URL, SESSION_PATH };

function isXTabUrl(url) {
  return isXUrl(url);
}

export async function requireCdp() {
  if (await isCdpAvailable()) {
    return { ok: true, cdpUrl: CDP_URL };
  }
  return {
    ok: false,
    reason: 'debug Chrome is not running on port 9222',
  };
}

export async function withBrowser(fn) {
  const cdp = await requireCdp();
  if (!cdp.ok) {
    return { ok: false, error: cdp.reason, code: 1 };
  }
  const browser = await connectBrowser();
  try {
    return await fn(browser);
  } finally {
    releaseCdpBrowser(browser);
  }
}

export function contextOf(browser) {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('No browser context on debug Chrome');
  }
  return context;
}

export function listPages(browser) {
  return contextOf(browser)
    .pages()
    .filter((page) => !page.isClosed())
    .map((page, index) => {
      const url = page.url();
      let kind = 'other';
      if (isXTabUrl(url)) kind = 'x';
      else if (url.startsWith('chrome-extension://') && url.includes('/src/cockpit/')) kind = 'cockpit';
      else if (url.startsWith('chrome-extension://') && /\/index\.html/.test(url)) kind = 'popup';
      else if (url.startsWith('chrome://extensions')) kind = 'ext';
      else if (url.startsWith('chrome-extension://')) kind = 'extension';
      return { id: index + 1, kind, title: '', url, page };
    });
}

export async function hydrateTabs(browser) {
  const tabs = listPages(browser);
  for (const tab of tabs) {
    tab.title = await tab.page.title().catch(() => '');
  }
  return tabs.map(({ page: _page, ...rest }) => rest);
}

export async function pageByKind(browser, kind, { create } = {}) {
  const tabs = listPages(browser);
  const match = tabs.find((tab) => tab.kind === kind);
  if (match) {
    await match.page.bringToFront();
    return match.page;
  }
  if (kind === 'x') {
    const focused = await focusXTab(browser);
    if (focused.ok) return focused.page;
    if (!create) return null;
    const page = await contextOf(browser).newPage();
    await page.bringToFront();
    return page;
  }
  if (!create) return null;
  return contextOf(browser).newPage();
}

export async function extensionUrls(browser) {
  const id =
    (await findAttentionXId(browser, { allowExtensionsPage: false })) ??
    (await findAttentionXId(browser, { allowExtensionsPage: true }));
  if (!id) return { ok: false, reason: 'AttentionX extension id not found' };
  return {
    ok: true,
    extensionId: id,
    popup: `chrome-extension://${id}/index.html`,
    cockpit: `chrome-extension://${id}/src/cockpit/index.html`,
  };
}

export function readSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return { generation: 0, pageUrl: '', refs: {} };
  }
}

export function writeSession(session) {
  try {
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(session), 'utf8');
  } catch {
    // Session hints are optional; clicking can still fail loud.
  }
}

export function saveRefs(pageUrl, refs) {
  const previous = readSession();
  const generation = (previous.generation || 0) + 1;
  const stored = {};
  for (const ref of refs) {
    stored[String(ref.n)] = {
      kind: ref.kind,
      name: ref.name,
      role: ref.role,
      index: ref.index,
    };
  }
  writeSession({ generation, pageUrl, refs: stored, savedAt: Date.now() });
  return generation;
}

export function resolveRef(token) {
  const parsed = parseRef(token);
  if (!parsed.ok) return parsed;
  const session = readSession();
  if (parsed.generation != null && session.generation && parsed.generation !== session.generation) {
    return {
      ok: false,
      stale: true,
      reason: `STALE_REF ${parsed.raw} (snapshot is g${session.generation})`,
    };
  }
  if (parsed.kind && parsed.kindIndex != null) {
    const matches = Object.entries(session.refs || {})
      .filter(([, meta]) => meta.kind === parsed.kind)
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    const hit = matches[parsed.kindIndex - 1];
    if (!hit) {
      return { ok: false, reason: `ref ${parsed.raw} not in the last snapshot` };
    }
    return {
      ok: true,
      n: Number(hit[0]),
      meta: hit[1],
      generation: session.generation,
    };
  }
  const meta = session.refs?.[String(parsed.n)];
  if (!meta) {
    return { ok: false, reason: `ref ${parsed.raw} not in the last snapshot` };
  }
  return { ok: true, n: parsed.n, meta, generation: session.generation };
}
