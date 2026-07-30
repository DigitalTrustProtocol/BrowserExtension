import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const DIST_PATH = path.join(REPO_ROOT, 'dist');
export const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const USER_DATA_DIR = 'C:/temp/chrome-debug';
export const CDP_URL = 'http://127.0.0.1:9222';
export const EXTENSION_NAME_PATTERN = /attentionx/i;
export const X_HOME_URL = 'https://x.com/';

function isXUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com');
  } catch {
    return false;
  }
}

function isEmptyTabUrl(url) {
  return (
    url === 'about:blank' ||
    url === 'chrome://newtab/' ||
    url.startsWith('chrome://new-tab-page')
  );
}

export async function hardReloadPage(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Page.reload', { ignoreCache: true });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  return page.url();
}

export async function prepareXTab(browser) {
  const context = browser.contexts()[0];
  const pages = context.pages().filter((page) => !page.isClosed());
  const xPages = pages.filter((page) => isXUrl(page.url()));

  if (xPages.length > 0) {
    const page = xPages[0];
    await page.bringToFront();
    const url = await hardReloadPage(page);
    return {
      ok: true,
      action: 'reloaded-existing-tab',
      url,
      cacheCleared: true,
    };
  }

  let page = pages.find((candidate) => isEmptyTabUrl(candidate.url()));
  if (!page) {
    page = await context.newPage();
  }

  await page.bringToFront();
  await page.goto(X_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return {
    ok: true,
    action: 'opened-x-in-empty-tab',
    url: page.url(),
    cacheCleared: false,
  };
}

export async function isCdpAvailable() {
  try {
    const response = await fetch(`${CDP_URL}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForCdp(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isCdpAvailable()) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

export function startDebugChrome() {
  spawn(
    CHROME_PATH,
    [
      '--remote-debugging-port=9222',
      `--user-data-dir=${USER_DATA_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { detached: true, stdio: 'ignore' },
  ).unref();
}

export async function ensureDebugChrome() {
  if (await isCdpAvailable()) {
    return { ok: true, action: 'reused-existing', cdpUrl: CDP_URL };
  }

  startDebugChrome();
  const ready = await waitForCdp();
  if (!ready) {
    return {
      ok: false,
      action: 'failed-to-start',
      reason: 'Chrome debug port 9222 did not become available',
      cdpUrl: CDP_URL,
    };
  }

  return { ok: true, action: 'started-new', cdpUrl: CDP_URL };
}

export async function connectBrowser() {
  return chromium.connectOverCDP(CDP_URL);
}

export async function getExtensionsPage(browser) {
  const context = browser.contexts()[0];
  let page = context.pages().find((candidate) => candidate.url().startsWith('chrome://extensions'));
  if (!page) {
    page = await context.newPage();
  }
  await page.bringToFront();
  await page.goto('chrome://extensions/');
  await page.waitForTimeout(1200);
  return page;
}

export async function enableDeveloperMode(page) {
  return page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const toolbar = manager?.shadowRoot?.querySelector('extensions-toolbar');
    const devMode = toolbar?.shadowRoot?.querySelector('#devMode');
    if (devMode instanceof HTMLInputElement && !devMode.checked) {
      devMode.click();
    }
    const loadButton = toolbar?.shadowRoot?.querySelector('#loadUnpacked');
    return {
      enabled: devMode instanceof HTMLInputElement ? devMode.checked : null,
      loadUnpackedVisible: Boolean(loadButton && !loadButton.hasAttribute('hidden')),
    };
  });
}

export async function listExtensions(page) {
  return page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const itemList = manager?.shadowRoot?.querySelector('extensions-item-list');
    const items = itemList?.shadowRoot?.querySelectorAll('extensions-item') ?? [];
    return Array.from(items).map((item) => ({
      id: item.getAttribute('id'),
      name: item.shadowRoot?.querySelector('#name')?.textContent?.trim() ?? '',
      hasErrors: Boolean(item.shadowRoot?.querySelector('#errors-button, #errorsButton')),
    }));
  });
}

export async function reloadAttentionX(page) {
  return page.evaluate((patternSource) => {
    const pattern = new RegExp(patternSource, 'i');
    const manager = document.querySelector('extensions-manager');
    const itemList = manager?.shadowRoot?.querySelector('extensions-item-list');
    const items = itemList?.shadowRoot?.querySelectorAll('extensions-item') ?? [];

    for (const item of items) {
      const name = item.shadowRoot?.querySelector('#name')?.textContent?.trim() ?? '';
      if (!pattern.test(name)) {
        continue;
      }
      const reloadButton = item.shadowRoot?.querySelector(
        '#dev-reload-button, cr-icon-button#reload, #reload-button',
      );
      reloadButton?.click();
      return {
        ok: true,
        action: 'reloaded',
        id: item.getAttribute('id'),
        name,
        hadErrors: Boolean(item.shadowRoot?.querySelector('#errors-button, #errorsButton')),
      };
    }

    return { ok: false, reason: 'AttentionX extension card not found' };
  }, EXTENSION_NAME_PATTERN.source);
}

export async function loadAttentionXUnpacked(page, distPath = DIST_PATH) {
  await enableDeveloperMode(page);

  const clicked = await page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const toolbar = manager?.shadowRoot?.querySelector('extensions-toolbar');
    const loadButton = toolbar?.shadowRoot?.querySelector('#loadUnpacked');
    if (!(loadButton instanceof HTMLElement)) {
      return { ok: false, reason: 'Load unpacked button not found' };
    }
    loadButton.click();
    return { ok: true };
  });

  if (!clicked.ok) {
    return clicked;
  }

  const fileChooser = await page.waitForEvent('filechooser', { timeout: 20000 });
  await fileChooser.setFiles(distPath);
  await page.waitForTimeout(2000);
  return { ok: true, action: 'loaded-unpacked', distPath };
}

export async function clearAttentionXErrors(page, extensionId) {
  if (!extensionId) {
    return { ok: false, reason: 'missing extension id' };
  }

  await page.goto(`chrome://extensions/?errors=${extensionId}`);
  await page.waitForTimeout(1000);

  const clearedOnErrorPage = await page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const errorPage = manager?.shadowRoot?.querySelector('extensions-error-page');
    const clearAll = errorPage?.shadowRoot?.querySelector(
      '#clearAll, #clear-all-button, cr-button#clearAll',
    );
    if (clearAll instanceof HTMLElement) {
      clearAll.click();
      return { ok: true, action: 'cleared-on-error-page' };
    }
    return { ok: false, reason: 'clear-all button not found' };
  });

  await page.goto('chrome://extensions/');
  await page.waitForTimeout(800);
  return clearedOnErrorPage;
}

export async function reloadAttentionXExtension({ ensureChrome = false } = {}) {
  if (ensureChrome && !(await isCdpAvailable())) {
    startDebugChrome();
    const ready = await waitForCdp();
    if (!ready) {
      throw new Error('Chrome debug port 9222 did not become available');
    }
  }

  if (!(await isCdpAvailable())) {
    return {
      ok: false,
      skipped: true,
      reason: 'Chrome debug browser is not running on port 9222',
    };
  }

  const browser = await connectBrowser();
  try {
    const page = await getExtensionsPage(browser);
    await enableDeveloperMode(page);

    let reloadResult = await reloadAttentionX(page);
    if (!reloadResult.ok) {
      reloadResult = await loadAttentionXUnpacked(page);
    }

    if (!reloadResult.ok) {
      return { ok: false, ...reloadResult };
    }

    await page.waitForTimeout(1200);

    let clearResult = { ok: true, action: 'none', reason: 'no errors reported' };
    if (reloadResult.hadErrors && reloadResult.id) {
      clearResult = await clearAttentionXErrors(page, reloadResult.id);
    }

    const extensions = await listExtensions(page);
    const attentionx = extensions.find((entry) => EXTENSION_NAME_PATTERN.test(entry.name));
    if (attentionx?.hasErrors && attentionx.id) {
      clearResult = await clearAttentionXErrors(page, attentionx.id);
    }

    const xTabResult = await prepareXTab(browser);

    return {
      ok: Boolean(attentionx),
      skipped: false,
      reloadResult,
      clearResult,
      xTabResult,
      attentionx,
      extensions,
      cdpUrl: CDP_URL,
      distPath: DIST_PATH,
    };
  } finally {
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
