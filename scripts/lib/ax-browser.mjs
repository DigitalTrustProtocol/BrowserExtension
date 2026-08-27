import {
  DIST_PATH,
  USER_DATA_DIR,
  ensureDebugChrome,
  findAttentionXId,
  focusXTab,
  getExtensionsPage,
  inspectXTimeline,
  listExtensions,
  reloadAttentionXExtension,
  EXTENSION_NAME_PATTERN,
} from './extension-dev-browser.mjs';
import { RUN } from './ax-help.mjs';
import { filterByQuery, truncateText } from './ax-toon.mjs';
import { formatRef, AX_REF_ATTR, MCP_SERVER, MCP_CDP, axRefSelector } from './ax-refs.mjs';
import {
  contextOf,
  extensionUrls,
  hydrateTabs,
  listPages,
  pageByKind,
  readSession,
  resolveRef,
  saveRefs,
  withBrowser,
} from './ax-session.mjs';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LIMIT = 24;
const POST_LIMIT = 12;
const TEXT_LIMIT = 500;
const AX_WAIT_MS = 450;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function limitValue(flags, fallback) {
  if (flags.limit == null || flags.limit === true) return fallback;
  const n = Number(flags.limit);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(200, Math.floor(n));
}

function pickFields(row, fields, defaults) {
  const keys = fields
    ? String(fields)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : defaults;
  const out = {};
  for (const key of keys) {
    out[key] = row[key] ?? '';
  }
  return out;
}

async function waitForPaint(page, extraMs = AX_WAIT_MS) {
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  await sleep(extraMs);
}

async function waitForX(page) {
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll('article').length === 0 ||
        document.querySelectorAll('[data-attentionx-chip]').length > 0 ||
        document.querySelector('#attentionx-signals') !== null,
      { timeout: 5000 },
    )
    .catch(() => {});
  await sleep(400);
}

function runDom(page, op) {
  return page.evaluate((operation) => {
    function visible(el) {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }

    function isAxHost(el) {
      return (
        el.hasAttribute('data-attentionx-chip') ||
        el.hasAttribute('data-attentionx-star') ||
        el.hasAttribute('data-attentionx-score') ||
        el.hasAttribute('data-attentionx-collapse-bar') ||
        el.hasAttribute('data-attentionx-profile-chip')
      );
    }

    function axHostOf(el) {
      let node = el;
      while (node) {
        if (node instanceof Element && isAxHost(node)) return node;
        const root = node.getRootNode?.();
        node = root instanceof ShadowRoot ? root.host : node.parentElement;
      }
      return null;
    }

    // Keep in sync with ax-dom.mjs
    function axLabel(el) {
      if (el == null || typeof el !== 'object') return '';
      const root = el.shadowRoot;
      const node = root?.querySelector('button, [role="button"], .score') ?? el;
      if (!node || typeof node.getAttribute !== 'function') return '';
      return (
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        String(node.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }

    function clickAxTarget(el, kind) {
      if (!el) return false;
      const isScore =
        kind === 'score' ||
        (typeof el.getAttribute === 'function' && el.getAttribute('data-attentionx-score') != null);
      if (isScore) {
        const inner = el.shadowRoot?.querySelector('button.score, button, [role="button"]');
        if (inner && typeof inner.click === 'function') {
          inner.click();
          return true;
        }
      }
      if (typeof el.click === 'function') {
        el.click();
        return true;
      }
      return false;
    }

    function kindOf(el) {
      if (el.hasAttribute('data-attentionx-star')) return 'star';
      if (el.getAttribute('data-attentionx-chip') === 'post') return 'star';
      if (el.hasAttribute('data-attentionx-chip') || el.hasAttribute('data-attentionx-profile-chip')) {
        return 'chip';
      }
      if (el.hasAttribute('data-attentionx-score')) return 'score';
      if (el.hasAttribute('data-attentionx-collapse-bar')) return 'collapse';
      const tag = el.tagName;
      if (tag === 'A' || el.getAttribute('role') === 'link') return 'link';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.getAttribute('contenteditable') === 'true') {
        return 'input';
      }
      if (el.getAttribute('role') === 'tab') return 'tab';
      return 'button';
    }

    function roleOf(el, kind) {
      if (kind === 'chip' || kind === 'star' || kind === 'score') return 'button';
      if (kind === 'collapse') return 'button';
      return el.getAttribute('role') || el.tagName.toLowerCase();
    }

    function visitShadow(root, visitEl) {
      const nodes = root.querySelectorAll('*');
      for (const el of nodes) {
        visitEl(el);
        if (el.shadowRoot) visitShadow(el.shadowRoot, visitEl);
      }
    }

    function collect() {
      const items = [];
      const seen = new Set();

      function push(el, kindOverride) {
        if (!el || seen.has(el) || !visible(el)) return;
        seen.add(el);
        const kind = kindOverride || kindOf(el);
        const name = (isAxHost(el) ? axLabel(el) : (
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          (el.textContent ?? '')
        ))
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
        if (!name && kind !== 'chip' && kind !== 'star' && kind !== 'score') return;
        items.push({ el, kind, role: roleOf(el, kind), name });
      }

      visitShadow(document, (el) => {
        if (isAxHost(el)) push(el);
      });

      const popover = document.querySelector('[data-attentionx-popover]');
      if (popover?.shadowRoot) {
        visitShadow(popover.shadowRoot, (el) => {
          if (el.matches('button, [role="button"], a[href], input, textarea, select')) {
            push(el, el.tagName === 'A' ? 'link' : el.tagName === 'INPUT' ? 'input' : 'button');
          }
        });
      }

      visitShadow(document, (el) => {
        if (axHostOf(el)) return;
        if (
          el.matches(
            'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="link"], [contenteditable="true"]',
          )
        ) {
          push(el);
        }
      });

      return items;
    }

    function serialize(items) {
      return items.map((item, index) => ({
        n: index + 1,
        kind: item.kind,
        role: item.role,
        name: item.name,
        index,
      }));
    }

    function xSummary() {
      const chips = [...document.querySelectorAll('[data-attentionx-chip]')];
      const stars = [...document.querySelectorAll('[data-attentionx-star]')];
      const labels = chips
        .slice(0, 6)
        .map((host) => host.shadowRoot?.querySelector('button')?.getAttribute('aria-label') ?? '')
        .filter(Boolean);
      return {
        url: location.href,
        title: document.title,
        articles: document.querySelectorAll('article').length,
        chips: chips.length,
        authorChips: chips.filter((host) => host.getAttribute('data-attentionx-chip') === 'author').length,
        stars: stars.length,
        scores: document.querySelectorAll('[data-attentionx-score]').length,
        tones: document.querySelectorAll(
          'article[data-attentionx-author-tone], article[data-attentionx-post-tone]',
        ).length,
        hidden: document.querySelectorAll('[data-attentionx-hidden="true"]').length,
        collapsed: document.querySelectorAll('[data-attentionx-collapsed="true"]').length,
        profile: Boolean(document.querySelector('[data-attentionx-profile-header]')),
        signals: Boolean(document.querySelector('#attentionx-signals')),
        popover: Boolean(document.querySelector('[data-attentionx-popover]')),
        login: /\/i\/flow\/login/.test(location.pathname),
        samples: labels,
      };
    }

    function xPosts() {
      return [...document.querySelectorAll('article')].map((article) => {
        const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? '';
        const postId = href.match(/status\/(\d+)/)?.[1] ?? '';
        const handleHref =
          article
            .querySelector('[data-testid="User-Name"] a[href^="/"], [data-testid="UserName"] a[href^="/"]')
            ?.getAttribute('href') ?? '';
        const handle = handleHref.replace(/^\//, '').split('/')[0] ?? '';
        const chip =
          article.querySelector('[data-attentionx-chip="author"]') ??
          article.querySelector('[data-attentionx-chip]:not([data-attentionx-star])');
        const star = article.querySelector('[data-attentionx-star]');
        const score = article.querySelector('[data-attentionx-score]');
        const cell = article.closest('[data-testid="cellInnerDiv"]');
        return {
          handle,
          postId,
          chip: axLabel(chip),
          star: axLabel(star),
          score: score?.shadowRoot?.querySelector('.score')?.textContent?.trim() || axLabel(score),
          tone: article.getAttribute('data-attentionx-author-tone') || '',
          postTone: article.getAttribute('data-attentionx-post-tone') || '',
          hidden: cell?.getAttribute('data-attentionx-hidden') === 'true',
          collapsed: cell?.getAttribute('data-attentionx-collapsed') === 'true',
        };
      });
    }

    function popover() {
      const host = document.querySelector('[data-attentionx-popover]');
      if (!host?.shadowRoot) return { open: false, text: '', actions: [] };
      const shell = host.shadowRoot.querySelector('.shell');
      const open = Boolean(shell && getComputedStyle(shell).display !== 'none');
      if (!open) return { open: false, text: '', actions: [] };
      const text = (shell?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const actions = [];
      visitShadow(host.shadowRoot, (el) => {
        if (el.matches('button, [role="button"], a[href]')) {
          const name = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (name) actions.push({ role: el.tagName === 'A' ? 'link' : 'button', name });
        }
      });
      return { open: true, text, actions };
    }

    function appSummary() {
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      const headings = [...document.querySelectorAll('h1, h2, h3')]
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 8);
      const errors = [...document.querySelectorAll('[role="alert"], .error, [data-error]')]
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 5);
      return { url: location.href, title: document.title, headings, errors, text };
    }

    const items = collect();
    if (operation.type === 'collect') return { items: serialize(items), popover: popover(), app: appSummary() };
    if (operation.type === 'xSummary') return xSummary();
    if (operation.type === 'xPosts') return xPosts();
    if (operation.type === 'popover') return popover();
    if (operation.type === 'app') return appSummary();
    if (operation.type === 'click') {
      const item = items[operation.index];
      if (!item) return { ok: false, reason: 'ref is not on this page' };
      if (operation.expectedName && item.name !== operation.expectedName) {
        return { ok: false, stale: true, reason: 'STALE_REF name mismatch' };
      }
      clickAxTarget(item.el, item.kind);
      return { ok: true, name: item.name, kind: item.kind };
    }
    if (operation.type === 'fill') {
      const item = items[operation.index];
      if (!item) return { ok: false, reason: 'ref is not on this page' };
      const el = item.el;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        el.value = operation.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, name: item.name };
      }
      if (el.isContentEditable) {
        el.focus();
        el.textContent = operation.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, name: item.name };
      }
      return { ok: false, reason: `ref is not an input (${item.kind})` };
    }
    if (operation.type === 'stamp') {
      const attr = operation.attr || 'data-ax-ref';
      function clear(root) {
        for (const el of root.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) clear(el.shadowRoot);
        }
      }
      clear(document);
      const live = collect();
      const gen = operation.generation;
      let stamped = 0;
      for (const stamp of operation.stamps ?? []) {
        const item = live[stamp.index];
        if (!item?.el) continue;
        item.el.setAttribute(attr, `g${gen}:${stamp.n}`);
        stamped += 1;
      }
      return { ok: true, stamped };
    }
    return { ok: false, reason: 'unknown dom op' };
  }, op);
}

function toRefRows(generation, items) {
  return items.map((item) => ({
    id: formatRef(generation, item.n),
    role: item.role,
    name: item.name,
    kind: item.kind,
  }));
}

async function snapshotPage(page, flags, extras = {}) {
  const collected = await runDom(page, { type: 'collect' });
  const all = collected.items ?? [];
  const matched = filterByQuery(all, flags.query, (item) => `${item.role} ${item.name} ${item.kind}`);
  const limit = flags.full ? Math.max(matched.length, 1) : limitValue(flags, DEFAULT_LIMIT);
  const shown = matched.slice(0, limit);
  const generation = saveRefs(page.url(), shown);
  if (shown.length > 0) {
    await runDom(page, {
      type: 'stamp',
      attr: AX_REF_ATTR,
      generation,
      stamps: shown.map((item) => ({ index: item.index, n: item.n })),
    });
  }
  const rows = toRefRows(generation, shown);
  const text = truncateText(collected.app?.text ?? '', TEXT_LIMIT, flags.full);
  const body = {
    page: {
      title: collected.app?.title || (await page.title().catch(() => '')),
      url: page.url(),
      refs: `${rows.length} of ${matched.length} matching (${all.length} total)`,
    },
    ...extras,
  };
  if (flags.query && matched.length === 0) {
    body.refs = `0 matching "${flags.query}" (${all.length} unfiltered — drop --query or use snapshot --full)`;
  } else if (rows.length === 0) {
    body.refs = '0 interactive refs on this page';
  } else {
    body.refs = rows;
    body.mcp = { server: MCP_SERVER, target: axRefSelector(generation, 'N') };
  }
  if (flags.full && text.text) body.text = text.text;
  return { generation, body, truncated: text.truncated, matched: matched.length, total: all.length };
}

async function focusedPage(browser, prefer = 'current') {
  if (prefer === 'x') {
    const focused = await focusXTab(browser);
    if (!focused.ok) return { ok: false, reason: focused.reason };
    return { ok: true, page: focused.page };
  }
  const pages = listPages(browser);
  const session = readSession();
  if (session.pageUrl) {
    const match = pages.find(
      (tab) => tab.url === session.pageUrl || tab.page.url() === session.pageUrl,
    );
    if (match) {
      await match.page.bringToFront();
      return { ok: true, page: match.page };
    }
  }
  const x = pages.find((tab) => tab.kind === 'x');
  if (x) {
    await x.page.bringToFront();
    return { ok: true, page: x.page };
  }
  const last = pages.at(-1);
  if (!last) return { ok: false, reason: 'no open tabs' };
  await last.page.bringToFront();
  return { ok: true, page: last.page };
}

async function openExtensionPageViaWorker(browser, target) {
  const context = contextOf(browser);
  let worker = context.serviceWorkers().find((candidate) => /background\.js/i.test(candidate.url()));
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 8000 }).catch(() => null);
  }
  if (!worker || !/background\.js/i.test(worker.url())) return null;
  const waiter = context.waitForEvent('page', { timeout: 15000 });
  await worker.evaluate(async (url) => {
    await chrome.tabs.create({ url });
  }, target);
  return waiter;
}

async function openExtensionPage(browser, kind, search = '') {
  const focused = await focusXTab(browser);
  if (!focused.ok) return { ok: false, reason: focused.reason };
  const urls = await extensionUrls(browser);
  if (!urls.ok) return urls;
  const target = `${urls[kind]}${search}`;
  let page = listPages(browser).find((tab) => {
    const url = tab.page.url();
    return url.startsWith(urls[kind]) && !url.startsWith('chrome-error:');
  })?.page;
  if (!page) {
    page = await openExtensionPageViaWorker(browser, target);
  }
  if (!page) return { ok: false, reason: 'failed to open extension page' };
  await page.bringToFront();
  if (search && !page.url().includes(search)) {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }
  await waitForPaint(page, 700);
  return { ok: true, page, extensionId: urls.extensionId };
}

export async function cmdHome() {
  return withBrowser(async (browser) => {
    const tabs = await hydrateTabs(browser);
    const xTab = tabs.find((tab) => tab.kind === 'x');
    const id = await findAttentionXId(browser, { allowExtensionsPage: false });
    let x = null;
    if (xTab) {
      const page = listPages(browser).find((tab) => tab.kind === 'x')?.page;
      if (page) {
        await page.bringToFront();
        await waitForX(page);
        x = await runDom(page, { type: 'xSummary' });
      }
    }
    return {
      ok: true,
      code: 0,
      doc: {
        chrome: 'up',
        cdp: MCP_CDP,
        mcp: { server: MCP_SERVER, isolated_plugin: 'never' },
        extension: id ? { id, popup: 'closed', cockpit: tabs.some((tab) => tab.kind === 'cockpit') } : 'not found',
        tabs: `${tabs.length} open`,
        x: x
          ? {
              url: x.url,
              articles: x.articles,
              chips: x.chips,
              stars: x.stars,
              popover: x.popover,
              login: x.login,
            }
          : '0 x.com tabs open',
      },
      help: x ? 'home-up' : 'x-empty',
    };
  });
}

export async function cmdGo() {
  if (!fs.existsSync(DIST_PATH)) {
    return {
      ok: false,
      code: 1,
      error: `dist/ not found. Run \`npm run build\` first.`,
    };
  }
  const chrome = await ensureDebugChrome();
  if (!chrome.ok) {
    return { ok: false, code: 1, error: chrome.reason, help: 'error-cdp' };
  }
  const reload = await reloadAttentionXExtension();
  const home = await cmdHome();
  return {
    ok: Boolean(reload.ok && home.ok),
    code: reload.ok && home.ok ? 0 : 1,
    doc: {
      chrome: chrome.action,
      reload: reload.ok ? reload.reloadResult?.action || 'reloaded' : reload.reason || 'failed',
      x: reload.xTabResult?.url || home.doc?.x,
      extension: reload.attentionx
        ? { id: reload.attentionx.id, errors: Boolean(reload.attentionx.hasErrors) }
        : home.doc?.extension,
    },
    help: 'go',
  };
}

export async function cmdReload() {
  const result = await reloadAttentionXExtension();
  if (result.skipped) {
    return {
      ok: true,
      code: 0,
      doc: { reload: `skipped (${result.reason})` },
      help: 'error-cdp',
    };
  }
  return {
    ok: Boolean(result.ok),
    code: result.ok ? 0 : 1,
    doc: {
      reload: result.reloadResult?.action || (result.ok ? 'reloaded' : 'failed'),
      extension: result.attentionx
        ? { id: result.attentionx.id, errors: Boolean(result.attentionx.hasErrors) }
        : 'not found',
      x: result.xTabResult?.url || '',
    },
    help: 'go',
  };
}

export async function cmdTabs(flags) {
  return withBrowser(async (browser) => {
    const tabs = await hydrateTabs(browser);
    const limit = limitValue(flags, 20);
    const rows = tabs.slice(0, limit).map((tab) => ({
      id: tab.id,
      kind: tab.kind,
      url: tab.url.slice(0, 80),
    }));
    return {
      ok: true,
      code: 0,
      doc:
        rows.length === 0
          ? { tabs: '0 tabs open in debug Chrome' }
          : { count: `${rows.length} of ${tabs.length} total`, tabs: rows },
      help: 'refs',
    };
  });
}

export async function cmdFocus(target) {
  const kind = String(target || '').toLowerCase();
  if (!['x', 'popup', 'cockpit', 'ext'].includes(kind)) {
    return {
      ok: false,
      code: 2,
      error: 'focus target must be x, popup, cockpit, or ext',
    };
  }
  return withBrowser(async (browser) => {
    if (kind === 'popup' || kind === 'cockpit') {
      const opened = await openExtensionPage(browser, kind);
      if (!opened.ok) return { ok: false, code: 1, error: opened.reason };
      return { ok: true, code: 0, doc: { focus: kind, url: opened.page.url() } };
    }
    if (kind === 'ext') {
      const page = await getExtensionsPage(browser);
      return { ok: true, code: 0, doc: { focus: 'ext', url: page.url() } };
    }
    const focused = await focusXTab(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason, help: 'x-empty' };
    return { ok: true, code: 0, doc: { focus: 'x', url: focused.url } };
  });
}

export async function cmdX(flags, sub = 'summary', refToken) {
  return withBrowser(async (browser) => {
    const focused = await focusXTab(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason, help: 'x-empty' };
    const page = focused.page;
    await waitForX(page);

    if (sub === 'chip' || sub === 'star') {
      const clicked = await clickOnPage(page, refToken, flags, { preferKind: sub === 'star' ? 'star' : 'chip' });
      if (!clicked.ok) return clicked;
      await sleep(500);
      const pop = await runDom(page, { type: 'popover' });
      const snap = await snapshotPage(page, flags, {
        clicked: clicked.doc?.clicked,
        popover: pop.open
          ? { open: true, text: truncateText(pop.text, TEXT_LIMIT, flags.full).text }
          : '0 popovers open on this page',
      });
      return { ok: true, code: 0, doc: snap.body, help: 'x-posts' };
    }

    if (sub === 'popover') {
      const pop = await runDom(page, { type: 'popover' });
      if (!pop.open) {
        return { ok: true, code: 0, doc: { popover: '0 popovers open on this page' }, help: 'x' };
      }
      const snap = await snapshotPage(page, flags, {
        popover: { open: true, text: truncateText(pop.text, TEXT_LIMIT, flags.full).text },
      });
      return { ok: true, code: 0, doc: snap.body, help: 'refs' };
    }

    if (sub === 'posts') {
      const posts = await runDom(page, { type: 'xPosts' });
      const filtered = filterByQuery(
        posts,
        flags.query,
        (row) => `${row.handle} ${row.chip} ${row.star} ${row.score} ${row.tone} ${row.postId}`,
      );
      const limit = flags.full ? filtered.length : limitValue(flags, POST_LIMIT);
      const defaults = ['handle', 'chip', 'star', 'tone'];
      const rows = filtered.slice(0, limit).map((row, index) => ({
        id: `@p${index + 1}`,
        ...pickFields(row, flags.fields, defaults),
      }));
      const collected = await runDom(page, { type: 'collect' });
      const axRefs = (collected.items ?? []).filter((item) => item.kind === 'chip' || item.kind === 'star');
      const generation = saveRefs(page.url(), axRefs);
      if (axRefs.length > 0) {
        await runDom(page, {
          type: 'stamp',
          attr: AX_REF_ATTR,
          generation,
          stamps: axRefs.map((item) => ({ index: item.index, n: item.n })),
        });
      }
      if (rows.length === 0) {
        return {
          ok: true,
          code: 0,
          doc: {
            posts: flags.query
              ? `0 posts matching "${flags.query}" (${posts.length} visible)`
              : '0 articles on this page',
          },
          help: 'x-empty',
        };
      }
      return {
        ok: true,
        code: 0,
        doc: { count: `${rows.length} of ${filtered.length} matching (${posts.length} articles)`, posts: rows },
        help: 'x-posts',
      };
    }

    const summary = await runDom(page, { type: 'xSummary' });
    const snap = flags.query ? await snapshotPage(page, flags) : null;
    return {
      ok: true,
      code: 0,
      doc: {
        x: {
          url: summary.url,
          articles: summary.articles,
          chips: summary.chips,
          stars: summary.stars,
          scores: summary.scores,
          tones: summary.tones,
          hidden: summary.hidden,
          collapsed: summary.collapsed,
          popover: summary.popover,
          login: summary.login,
        },
        samples: summary.samples.length ? summary.samples : '0 chip labels',
        ...(snap ? { refs: snap.body.refs } : {}),
      },
      help: summary.articles === 0 ? 'x-empty' : 'x',
    };
  });
}

async function clickOnPage(page, token, flags, { preferKind } = {}) {
  const resolved = resolveRef(token);
  if (!resolved.ok) {
    return { ok: false, code: resolved.stale ? 1 : 2, error: resolved.reason, help: resolved.stale ? 'stale' : 'refs' };
  }
  if (preferKind && resolved.meta.kind !== preferKind && resolved.meta.kind !== 'chip' && resolved.meta.kind !== 'star') {
    return { ok: false, code: 1, error: `ref ${token} is ${resolved.meta.kind}, not ${preferKind}` };
  }
  const result = await runDom(page, {
    type: 'click',
    index: resolved.n - 1,
    expectedName: resolved.meta.name,
  });
  if (!result.ok) {
    return { ok: false, code: 1, error: result.reason, help: result.stale ? 'stale' : 'refs' };
  }
  await sleep(AX_WAIT_MS);
  return { ok: true, doc: { clicked: { ref: token, name: result.name, kind: result.kind } } };
}

export async function cmdInspect(flags) {
  return withBrowser(async (browser) => {
    const focused = await focusXTab(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason, help: 'x-empty' };
    await waitForX(focused.page);
    const x = await inspectXTimeline(browser);
    const doc = {
      x: x.ok
        ? {
            url: x.url,
            articles: x.articles,
            chips: x.chips,
            stars: x.postStars,
            scores: x.scores,
            popover: x.popoverOpen,
          }
        : x.reason,
    };
    if (flags['x-only'] || flags.xOnly) {
      return { ok: Boolean(x.ok), code: x.ok ? 0 : 1, doc, help: 'x' };
    }
    const popup = await openExtensionPage(browser, 'popup');
    if (popup.ok) {
      const app = await runDom(popup.page, { type: 'app' });
      doc.popup = {
        title: app.title,
        headings: app.headings.join(' | ').slice(0, 120) || '0 headings',
        errors: app.errors.length,
      };
    } else {
      doc.popup = popup.reason;
    }
    const cockpit = await openExtensionPage(browser, 'cockpit');
    if (cockpit.ok) {
      const app = await runDom(cockpit.page, { type: 'app' });
      doc.cockpit = {
        title: app.title,
        headings: app.headings.join(' | ').slice(0, 120) || '0 headings',
        errors: app.errors.length,
      };
    } else {
      doc.cockpit = cockpit.reason;
    }
    const page = await getExtensionsPage(browser);
    const extensions = await listExtensions(page);
    const attentionx = extensions.find((entry) => EXTENSION_NAME_PATTERN.test(entry.name)) ?? null;
    doc.extension = attentionx
      ? { id: attentionx.id, errors: Boolean(attentionx.hasErrors) }
      : '0 AttentionX cards on chrome://extensions';
    return { ok: true, code: 0, doc, help: 'home-up' };
  });
}

export async function cmdPopup(flags) {
  return withBrowser(async (browser) => {
    const opened = await openExtensionPage(browser, 'popup');
    if (!opened.ok) return { ok: false, code: 1, error: opened.reason, help: 'error-cdp' };
    const snap = await snapshotPage(opened.page, flags);
    return { ok: true, code: 0, doc: { popup: opened.extensionId, ...snap.body }, help: 'popup' };
  });
}

export async function cmdCockpit(flags) {
  const allowed = ['users', 'posts', 'events', 'outbox', 'cockpit', 'log', 'danger', 'user-events'];
  const pageId = flags.page ? String(flags.page) : '';
  if (pageId && !allowed.includes(pageId)) {
    return {
      ok: false,
      code: 2,
      error: `unknown cockpit page \`${pageId}\``,
      helpLines: [`valid --page values: ${allowed.join(', ')}`],
    };
  }
  const search = pageId ? `?page=${pageId}` : '';
  return withBrowser(async (browser) => {
    const opened = await openExtensionPage(browser, 'cockpit', search);
    if (!opened.ok) return { ok: false, code: 1, error: opened.reason };
    const snap = await snapshotPage(opened.page, flags);
    return {
      ok: true,
      code: 0,
      doc: { cockpit: pageId || 'users', ...snap.body },
      help: 'cockpit',
    };
  });
}

export async function cmdExt() {
  return withBrowser(async (browser) => {
    const page = await getExtensionsPage(browser);
    const extensions = await listExtensions(page);
    const attentionx = extensions.find((entry) => EXTENSION_NAME_PATTERN.test(entry.name)) ?? null;
    if (!attentionx) {
      return { ok: true, code: 0, doc: { extension: '0 AttentionX cards on chrome://extensions' }, help: 'go' };
    }
    return {
      ok: true,
      code: 0,
      doc: { extension: { id: attentionx.id, name: attentionx.name, errors: Boolean(attentionx.hasErrors) } },
    };
  });
}

export async function cmdOpen(url, flags) {
  if (!url) return { ok: false, code: 2, error: 'open requires a URL', helpLines: [`${RUN} open <url> --query "<text>"`] };
  return withBrowser(async (browser) => {
    let page = listPages(browser).find((tab) => tab.kind === 'x')?.page;
    if (!page) page = listPages(browser).at(-1)?.page;
    if (!page) page = await pageByKind(browser, 'x', { create: true });
    await page.bringToFront();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/x\.com|twitter\.com/.test(url)) await waitForX(page);
    else await waitForPaint(page);
    const snap = await snapshotPage(page, flags);
    return { ok: true, code: 0, doc: snap.body, help: 'refs' };
  });
}

export async function cmdSnapshot(flags) {
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    const snap = await snapshotPage(focused.page, flags);
    return { ok: true, code: 0, doc: snap.body, help: 'refs' };
  });
}

export async function cmdClick(token, flags) {
  if (!token) return { ok: false, code: 2, error: 'click requires a ref like @g1:3' };
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    const clicked = await clickOnPage(focused.page, token, flags);
    if (!clicked.ok) return clicked;
    const snap = await snapshotPage(focused.page, flags, clicked.doc);
    return { ok: true, code: 0, doc: snap.body, help: 'refs' };
  });
}

export async function cmdFill(token, text, flags) {
  if (!token || text == null) {
    return { ok: false, code: 2, error: 'fill requires @<ref> and text' };
  }
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    const resolved = resolveRef(token);
    if (!resolved.ok) {
      return { ok: false, code: resolved.stale ? 1 : 2, error: resolved.reason, help: 'stale' };
    }
    const filled = await runDom(focused.page, {
      type: 'fill',
      index: resolved.n - 1,
      text: String(text),
    });
    if (!filled.ok) return { ok: false, code: 1, error: filled.reason };
    if (flags.submit) await focused.page.keyboard.press('Enter');
    await waitForPaint(focused.page, 600);
    const snap = await snapshotPage(focused.page, flags, { filled: { ref: token, name: filled.name } });
    return { ok: true, code: 0, doc: snap.body, help: 'refs' };
  });
}

export async function cmdType(text, flags) {
  if (text == null || text === '') return { ok: false, code: 2, error: 'type requires text' };
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    await focused.page.keyboard.type(String(text));
    const snap = await snapshotPage(focused.page, flags);
    return { ok: true, code: 0, doc: snap.body, help: 'refs' };
  });
}

export async function cmdPress(key, flags) {
  if (!key) return { ok: false, code: 2, error: 'press requires a key (Enter, Escape, Tab, ...)' };
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    await focused.page.keyboard.press(key);
    await sleep(AX_WAIT_MS);
    const snap = await snapshotPage(focused.page, flags);
    return { ok: true, code: 0, doc: snap.body, help: 'refs' };
  });
}

export async function cmdScroll(dir, flags) {
  const allowed = ['up', 'down', 'top', 'bottom'];
  if (!allowed.includes(dir)) {
    return { ok: false, code: 2, error: 'scroll direction must be up, down, top, or bottom' };
  }
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    await focused.page.evaluate((direction) => {
      if (direction === 'top') window.scrollTo(0, 0);
      else if (direction === 'bottom') window.scrollTo(0, document.body.scrollHeight);
      else window.scrollBy(0, direction === 'down' ? window.innerHeight * 0.9 : -window.innerHeight * 0.9);
    }, dir);
    await sleep(500);
    const snap = await snapshotPage(focused.page, flags);
    return { ok: true, code: 0, doc: { scrolled: dir, ...snap.body }, help: 'refs' };
  });
}

export async function cmdWait(what, flags) {
  if (!what) return { ok: false, code: 2, error: 'wait requires milliseconds or text' };
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    if (/^\d+$/.test(what)) {
      await sleep(Number(what));
    } else {
      await focused.page.getByText(what, { exact: false }).first().waitFor({ timeout: 15000 });
    }
    const snap = await snapshotPage(focused.page, flags);
    return { ok: true, code: 0, doc: { waited: what, ...snap.body }, help: 'refs' };
  });
}

export async function cmdEval(js, flags) {
  if (!js) return { ok: false, code: 2, error: 'eval requires a JavaScript expression' };
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    const expression = String(js).trim();
    const wrapped = /^(?:async\s*)?(?:function\b|\(|\(\)|\(\s*\)|\(\s*async)/.test(expression)
      ? expression
      : `(() => (${expression}))()`;
    let value;
    try {
      value = await focused.page.evaluate(wrapped);
    } catch (error) {
      return { ok: false, code: 1, error: error instanceof Error ? error.message : String(error) };
    }
    const rendered = truncateText(
      typeof value === 'string' ? value : JSON.stringify(value),
      TEXT_LIMIT,
      flags.full,
    );
    return { ok: true, code: 0, doc: { eval: rendered.text } };
  });
}

export async function cmdScreenshot(outPath, flags) {
  return withBrowser(async (browser) => {
    const focused = await focusedPage(browser);
    if (!focused.ok) return { ok: false, code: 1, error: focused.reason };
    const dest = outPath
      ? path.resolve(String(outPath))
      : path.join(USER_DATA_DIR, 'ax-screenshot.png');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await focused.page.screenshot({ path: dest, fullPage: Boolean(flags.full) });
    return { ok: true, code: 0, doc: { screenshot: dest.replace(/\\/g, '/') } };
  });
}

export async function cmdMcp() {
  return withBrowser(async (browser) => {
    const tabs = await hydrateTabs(browser);
    const session = readSession();
    const rows = tabs.slice(0, 8).map((tab) => ({
      id: tab.id,
      kind: tab.kind,
      url: tab.url.slice(0, 80),
    }));
    return {
      ok: true,
      code: 0,
      doc: {
        mcp: {
          server: MCP_SERVER,
          cdp: MCP_CDP,
          isolated_plugin: 'never — that browser is not this Chrome',
        },
        never: 'browser_close, launching a second Chrome, plugin-playwright for AttentionX',
        stamps: session.generation
          ? axRefSelector(session.generation, 'N')
          : '0 stamps until an AXI snapshot',
        tabs: rows.length ? rows : '0 tabs open in debug Chrome',
      },
      help: 'mcp',
    };
  });
}

export async function cmdSetup() {
  return {
    ok: true,
    code: 0,
    doc: {
      setup: 'Cursor skill at .cursor/skills/attentionx-dev-browser',
      bin: 'npm run ax --',
      mcp: `${MCP_SERVER} attaches to ${MCP_CDP} (same Chrome as AXI)`,
      isolated_plugin: 'never for AttentionX',
    },
  };
}