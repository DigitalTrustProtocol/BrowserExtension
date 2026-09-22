#!/usr/bin/env node
/**
 * AttentionX user-journey runner (AXI on debug Chrome :9222).
 *
 *   node scripts/journeys/run.mjs
 *   node scripts/journeys/run.mjs --no-wipe
 *   node scripts/journeys/run.mjs --only surfaces,demo
 *
 * Default wipes the debug-profile vault (Danger Zone / DELETE_USER_DATA)
 * so first-login JustWorks can be exercised. --no-wipe inspects current state.
 *
 * Does not click likes / follows / DMs on X. Does not fix product bugs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ax, axOk, findRef, includesText, parseRefs, waitMs } from './lib/ax.mjs';
import {
  clickNamed,
  deleteUserData,
  ensureXHome,
  openCockpit,
  openPopup,
  pollSession,
  probeSession,
} from './lib/session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(HERE, 'last-report.json');

const args = process.argv.slice(2);
const NO_WIPE = args.includes('--no-wipe');
const onlyArg = args.find((item) => item.startsWith('--only=')) || '';
const onlyList = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : null;

const report = {
  startedAt: new Date().toISOString(),
  flags: { wipe: !NO_WIPE, only: onlyList },
  steps: [],
};

function record(id, title, status, detail) {
  const step = {
    id,
    title,
    status,
    detail: detail ?? null,
    at: new Date().toISOString(),
  };
  report.steps.push(step);
  const mark = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'skip' ? 'SKIP' : status.toUpperCase();
  console.log(`[${mark}] ${id}  ${title}`);
  if (detail && (status === 'fail' || status === 'blocker')) {
    console.log(`       ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
  return step;
}

async function step(id, title, fn) {
  if (onlyList && !onlyList.includes(id.split('.')[0]) && !onlyList.includes(id)) {
    record(id, title, 'skip', 'filtered by --only');
    return null;
  }
  try {
    const detail = await fn();
    record(id, title, 'pass', detail ?? null);
    return detail;
  } catch (error) {
    record(id, title, 'fail', error instanceof Error ? error.message : String(error));
    return null;
  }
}

function expect(condition, message, detail) {
  if (!condition) {
    const extra = detail ? ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '';
    throw new Error(`${message}${extra}`);
  }
}

function compact(value, max = 240) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

async function journeySurfaces() {
  await step('surfaces.go', 'Debug Chrome + extension available', async () => {
    const home = await ax([]);
    if (!home.ok) {
      const go = await ax(['go'], { timeoutMs: 120_000 });
      expect(go.ok, 'ax go failed', go.stdout || go.stderr);
      return compact(go.stdout);
    }
    return compact(home.stdout);
  });

  await step('surfaces.ext', 'AttentionX extension card is loaded', async () => {
    const out = await axOk(['ext']);
    expect(!includesText(out, '0 AttentionX'), 'No AttentionX card on chrome://extensions', out);
    expect(!includesText(out, 'errors: true'), 'Extension card reports errors', out);
    return compact(out);
  });

  await step('surfaces.tabs', 'X tab exists on debug Chrome', async () => {
    const out = await axOk(['tabs']);
    expect(includesText(out, 'x.com') || includesText(out, 'twitter.com'), 'No X tab open', out);
    return compact(out);
  });
}

async function journeyCurrent() {
  await step('current.x-home', 'Open x.com/home', async () => compact(await ensureXHome()));

  const probed = await step('current.session', 'Read panel session before wipe', async () => {
    const { probe } = await probeSession();
    expect(probe && probe.route, 'GET_PANEL_SESSION returned no route', probe);
    return probe;
  });
  report.before = probed;
}

async function journeyWipe() {
  if (NO_WIPE) {
    record('wipe.all', 'Wipe vault + cache (first-login reset)', 'skip', '--no-wipe');
    return;
  }

  await step('wipe.all', 'Danger Zone DELETE_USER_DATA mode=all', async () => {
    const result = await deleteUserData('all');
    expect(result && (result.ok === true || result.data), 'DELETE_USER_DATA did not succeed', result);
    return result;
  });

  await step('wipe.reload', 'Reload extension after wipe', async () => {
    const out = await axOk(['go'], { timeoutMs: 120_000 });
    await waitMs(1500);
    return compact(out);
  });
}

async function journeyFirstLogin() {
  await step('first-login.x', 'Focus x.com/home after empty vault', async () => compact(await ensureXHome()));

  await step('first-login.connect', 'Reconnect X if Delete All left the host disconnected', async () => {
    const { probe } = await probeSession();
    if (probe.route !== 'siteDisconnected') return { skipped: probe.route };
    await openPopup();
    const clicked = await clickNamed('Connect site', { query: 'Connect' });
    const next = await pollSession(
      (row) => row?.route !== 'siteDisconnected',
      { timeoutMs: 15_000, label: 'site reconnect' },
    );
    return { clicked: clicked.ref, probe: next.probe };
  });

  const reached = await step('first-login.provision', 'JustWorks provisions a key and offers Demo/Live', async () => {
    const { probe } = await pollSession(
      (row) => {
        if (!row) return false;
        if (row.justWorksFailed) return true;
        if (row.route === 'firstRun' || row.route === 'afterKeyClear') return true;
        if (row.route === 'demoChoice') return true;
        if (row.route === 'xHome' && row.hasIdentity) return true;
        if (row.route === 'xLoggedOut' || row.route === 'xUnknown' || row.route === 'unsupportedSite') {
          return true;
        }
        return false;
      },
      { timeoutMs: 25_000, label: 'justWorks → demoChoice' },
    );

    const snap = await openPopup();
    return { probe, popupTextHas: summarizePopup(snap) };
  });

  if (!reached?.probe) return;

  await step('first-login.route', 'First-login route is demoChoice (or documented fallback)', async () => {
    const route = reached.probe.route;
    if (route === 'demoChoice') {
      expect(reached.probe.hasIdentity !== false, 'demoChoice without identity', reached.probe);
      return reached.probe;
    }
    if (route === 'xHome') {
      return { note: 'Skipped demoChoice — already on xHome after provision', probe: reached.probe };
    }
    if (route === 'xLoggedOut') {
      throw new Error('X is logged out on the debug profile — cannot finish first-login binding');
    }
    if (route === 'xUnknown') {
      throw new Error('Active X account is unknown after wipe — ENSURE_ACTIVE_X_ACCOUNT did not resolve');
    }
    if (route === 'firstRun') {
      throw new Error(`JustWorks failed and fell back to firstRun wizard. Probe: ${JSON.stringify(reached.probe)}`);
    }
    if (route === 'afterKeyClear') {
      throw new Error(`Route is afterKeyClear instead of JustWorks auto-provision. Probe: ${JSON.stringify(reached.probe)}`);
    }
    throw new Error(`Unexpected first-login route ${route}: ${JSON.stringify(reached.probe)}`);
  });

  await step('first-login.ui', 'Popup shows Demo/Live choice copy', async () => {
    const snap = await openPopup();
    const demo = includesText(snap, 'Use Demo') || includesText(snap, 'Try Demo');
    const live = includesText(snap, 'Use Live');
    const ready = includesText(snap, "You're ready") || includesText(snap, 'ready');
    if (reached.probe.route === 'xHome') {
      return { skipped: 'already xHome', preview: compact(snap) };
    }
    expect(demo && live, 'Demo/Live buttons missing on demoChoice', compact(snap));
    expect(ready || includesText(snap, 'trust key'), 'Ready copy missing', compact(snap));
    return { demo, live, ready };
  });
}

function summarizePopup(snap) {
  return {
    useDemo: includesText(snap, 'Use Demo'),
    useLive: includesText(snap, 'Use Live'),
    settingUp: includesText(snap, 'Setting up'),
    demoBanner: includesText(snap, 'Demo data is random'),
    addAccount: includesText(snap, 'Add account'),
    unlock: includesText(snap, 'Unlock') || includesText(snap, 'password'),
  };
}

async function journeyDemo() {
  await step('demo.choose', 'Choose Use Demo from first-login gate', async () => {
    const { probe } = await probeSession();
    if (probe?.route === 'xHome' && (probe.appMode === 'demo' || probe.appMode?.mode === 'demo')) {
      return { skipped: 'already in demo', probe };
    }
    await openPopup();
    if (probe?.route === 'demoChoice') {
      const clicked = await clickNamed('Use Demo', { query: 'Demo' });
      await waitMs(2000);
      const next = await pollSession(
        (row) => row?.route === 'xHome' || row?.appMode === 'demo' || row?.appMode?.mode === 'demo',
        { timeoutMs: 30_000, label: 'demo xHome' },
      );
      return { via: 'demoChoice', clicked: clicked.ref, probe: next.probe };
    }
    if (probe?.route !== 'xHome' && probe?.route !== 'siteDisconnected') {
      throw new Error(`Need demoChoice or home Demo toggle, got ${probe?.route}`);
    }
    const clicked = await clickNamed('Demo', { query: 'Demo' });
    await waitMs(2000);
    const next = await pollSession(
      (row) => row?.route === 'xHome' || row?.appMode === 'demo' || row?.appMode?.mode === 'demo',
      { timeoutMs: 30_000, label: 'demo xHome' },
    );
    return { clicked: clicked.ref, probe: next.probe };
  });

  await step('demo.mode', 'GET_APP_MODE is demo and events are seeded', async () => {
    const { probe } = await pollSession(
      (row) => row?.appMode === 'demo' || row?.appMode?.mode === 'demo',
      { timeoutMs: 20_000, label: 'appMode=demo' },
    );
    expect(probe.route === 'xHome' || probe.route === 'siteDisconnected', 'Demo mode but route is not home', probe);
    expect(typeof probe.demoEvents === 'number' && probe.demoEvents > 0, 'Demo event count is 0', probe);
    expect(probe.binding?.kind === 'localBound' || probe.hasIdentity, 'No local binding after demo seed', probe);
    return probe;
  });

  await step('demo.banner', 'Home panel shows demo banner and chain accounts', async () => {
    const snap = await openPopup();
    expect(
      includesText(snap, 'Demo') && (includesText(snap, 'random') || includesText(snap, 'Demo mode')),
      'Demo banner copy missing',
      compact(snap),
    );
    const chainHit =
      includesText(snap, 'Elon') ||
      includesText(snap, 'SpaceX') ||
      includesText(snap, 'Tesla') ||
      includesText(snap, 'NASA');
    expect(chainHit, 'Demo chain accounts (Elon/SpaceX/Tesla/NASA) not visible on home', compact(snap));
    return summarizePopup(snap);
  });

  await step('demo.settings', 'Settings can open from the popup menu', async () => {
    await openPopup();
    const menu = findRef(await axOk(['snapshot', '--query', 'menu', '--full']), 'menu')
      || findRef(await axOk(['snapshot', '--full']), 'Settings')
      || findRef(await axOk(['snapshot', '--full']), 'Menu');
    if (!menu) {
      const snap = await axOk(['snapshot', '--full']);
      throw new Error(`No menu/settings control. Refs: ${compact(snap, 800)}`);
    }
    await axOk(['click', menu.id]);
    await waitMs(400);
    const after = await axOk(['snapshot', '--query', 'Settings', '--full']);
    expect(
      includesText(after, 'Settings') || includesText(after, 'Nostr') || includesText(after, 'Bindings'),
      'Settings overlay missing after menu click',
      compact(after),
    );
    return compact(after);
  });
}

async function journeyCockpit() {
  for (const page of ['users', 'events', 'outbox', 'log', 'danger', 'admin']) {
    await step(`cockpit.${page}`, `Application page "${page}" loads`, async () => {
      const snap = await openCockpit(page);
      expect(!includesText(snap, 'Something went wrong'), `${page} rendered an error`, compact(snap));
      expect(parseRefs(snap).length > 0 || includesText(snap, page), `${page} looks empty`, compact(snap));
      return { refs: parseRefs(snap).length, preview: compact(snap) };
    });
  }

  await step('cockpit.graph', 'Graph deep-link opens Application Graph', async () => {
    await openCockpit();
    await axOk([
      'eval',
      '(() => { location.search = "?mode=graph"; return location.search })()',
    ]);
    await waitMs(1500);
    const snap = await axOk(['snapshot', '--full']);
    expect(
      includesText(snap, 'Graph') || includesText(snap, 'Path') || includesText(snap, 'degree'),
      'Graph chrome missing',
      compact(snap),
    );
    return compact(snap);
  });

  await step('cockpit.users-chrome', 'Users page shows named X chrome (not only Unknown)', async () => {
    await ensureXHome();
    const snap = await openCockpit('users');
    const named =
      includesText(snap, 'Elon') ||
      includesText(snap, 'SpaceX') ||
      includesText(snap, '@') ||
      includesText(snap, 'elonmusk');
    const unknownHeavy = (snap.match(/Unknown/gi) || []).length;
    expect(named, 'Users page has no named X chrome', compact(snap));
    return { named, unknownHeavy, preview: compact(snap) };
  });
}

async function journeyTimeline() {
  await step('x.summary', 'Timeline chips/stars extract via AXI', async () => {
    await ensureXHome();
    await waitMs(1500);
    const summary = await axOk(['x'], { timeoutMs: 45_000 });
    const posts = await axOk(['x', 'posts'], { timeoutMs: 45_000 });
    expect(
      includesText(summary, 'chip') || includesText(posts, 'chip') || includesText(posts, '@c'),
      'No AttentionX chips on the home timeline',
      compact(summary + '\n' + posts, 800),
    );
    return { summary: compact(summary), posts: compact(posts) };
  });

  await step('x.chip', 'Open a trust chip popover', async () => {
    const posts = await axOk(['x', 'posts'], { timeoutMs: 45_000 });
    const chip = posts.match(/@c\d+/)?.[0] || findRef(posts, 'chip')?.id || '@c1';
    const pop = await axOk(['x', 'chip', chip], { timeoutMs: 30_000 });
    expect(
      includesText(pop, 'Trust') ||
        includesText(pop, 'Neutral') ||
        includesText(pop, 'Rate') ||
        includesText(pop, 'popover'),
      'Chip popover missing trust UI',
      compact(pop),
    );
    return compact(pop);
  });
}

async function journeyLive() {
  await step('live.switch', 'Switch from Demo to Live on the home panel', async () => {
    await openPopup();
    const snap = await axOk(['snapshot', '--query', 'Live', '--full']);
    const liveRef = findRef(snap, 'Use Live') || findRef(snap, 'Live');
    if (!liveRef) throw new Error(`No Live control on home:\n${compact(snap, 800)}`);
    await axOk(['click', liveRef.id]);
    await waitMs(1500);
    const { probe } = await pollSession(
      (row) => row?.appMode === 'production' || row?.appMode?.mode === 'production',
      { timeoutMs: 20_000, label: 'appMode=production' },
    );
    expect(probe.route === 'xHome' || probe.route === 'siteDisconnected', 'Live switch left unexpected route', probe);
    return probe;
  });

  await step('live.banner-gone', 'Demo banner is gone after Live', async () => {
    const snap = await openPopup();
    expect(!includesText(snap, 'Demo data is random'), 'Demo banner still visible in Live', compact(snap));
    return summarizePopup(snap);
  });
}

async function journeyBindings() {
  await step('bindings.operator', 'Operator X is bound to a local Nostr key', async () => {
    const { probe } = await probeSession();
    expect(probe.binding?.kind === 'localBound', 'Binding is not localBound', probe.binding || probe);
    expect(probe.hasIdentity, 'GET_STATE.hasIdentity is false', probe);
    expect(probe.vault?.kind === 'ready' || probe.vault?.accountCount > 0, 'Vault has no accounts', probe.vault);
    return {
      binding: probe.binding,
      vault: probe.vault,
      npub: probe.npub,
      activeX: probe.activeX,
    };
  });

  await step('bindings.settings', 'Bindings / Nostr Keys reachable from menu', async () => {
    await openPopup();
    const full = await axOk(['snapshot', '--full']);
    const opener =
      findRef(full, 'Settings') ||
      findRef(full, 'menu') ||
      findRef(full, 'Avatar') ||
      findRef(await axOk(['snapshot', '--query', 'account', '--full']), 'button');
    if (!opener) throw new Error(`No settings/account opener:\n${compact(full, 800)}`);
    await axOk(['click', opener.id]);
    await waitMs(400);
    const after = await axOk(['snapshot', '--full']);
    const hit =
      includesText(after, 'Bindings') ||
      includesText(after, 'Nostr') ||
      includesText(after, 'Keys') ||
      includesText(after, 'Security');
    expect(hit, 'Bindings/Nostr Keys UI not visible', compact(after));
    return compact(after);
  });
}

async function journeyAfterClear() {
  if (NO_WIPE) {
    record('after-clear.keys', 'Delete keys only → afterKeyClear wizard', 'skip', '--no-wipe');
    return;
  }

  await step('after-clear.keys', 'DELETE_USER_DATA mode=keys shows afterKeyClear', async () => {
    const result = await deleteUserData('keys');
    expect(result && (result.ok === true || result.data), 'keys delete failed', result);
    await axOk(['reload'], { timeoutMs: 60_000 });
    await waitMs(1500);
    await ensureXHome();
    const { probe } = await pollSession(
      (row) =>
        row?.route === 'afterKeyClear' ||
        row?.route === 'justWorks' ||
        row?.route === 'firstRun' ||
        row?.route === 'demoChoice',
      { timeoutMs: 20_000, label: 'after key clear' },
    );
    return { delete: result, probe };
  });

  await step('after-clear.wizard', 'Add account / JustWorks recovers after key clear', async () => {
    const { probe } = await probeSession();
    if (probe.route === 'justWorks' || probe.route === 'demoChoice') {
      return { recovered: probe.route, probe };
    }
    if (probe.route !== 'afterKeyClear') {
      throw new Error(`Expected afterKeyClear or auto-reprovision, got ${probe.route}`);
    }
    const snap = await openPopup();
    expect(includesText(snap, 'Add account') || includesText(snap, 'Get started'), 'Add-account CTA missing', compact(snap));
    const clicked = await clickNamed('Add account', { query: 'account', required: false });
    if (!clicked.clicked) await clickNamed('Get started', { query: 'started', required: false });
    await waitMs(600);
    const wizard = await axOk(['snapshot', '--full']);
    expect(
      includesText(wizard, 'Advanced') ||
        includesText(wizard, 'passkey') ||
        includesText(wizard, 'Credential') ||
        includesText(wizard, 'browser'),
      'Wizard method step missing',
      compact(wizard),
    );
    return compact(wizard);
  });

  await step('after-clear.reprovision', 'Re-run JustWorks and choose Live so the profile stays usable', async () => {
    await ensureXHome();
    const { probe } = await pollSession(
      (row) => row?.route === 'demoChoice' || row?.route === 'xHome' || row?.route === 'justWorks',
      { timeoutMs: 25_000, label: 'reprovision' },
    );
    if (probe.route === 'justWorks') {
      const next = await pollSession(
        (row) => row?.route === 'demoChoice' || row?.route === 'xHome',
        { timeoutMs: 20_000, label: 'reprovision settle' },
      );
      if (next.probe.route === 'xHome') return next.probe;
    }
    if (probe.route === 'demoChoice' || (await probeSession()).probe?.route === 'demoChoice') {
      await openPopup();
      await clickNamed('Use Live', { query: 'Live' });
      const live = await pollSession(
        (row) => row?.route === 'xHome',
        { timeoutMs: 20_000, label: 'reprovision Live' },
      );
      return live.probe;
    }
    return probe;
  });
}

async function journeyWizardMethods() {
  await step('wizard.methods-visible', 'Wizard method cards exist (when firstRun/afterKeyClear)', async () => {
    const { probe } = await probeSession();
    if (probe.route !== 'firstRun' && probe.route !== 'afterKeyClear') {
      return { skipped: `route=${probe.route} — method step only on firstRun/afterKeyClear` };
    }
    const snap = await openPopup();
    if (probe.route === 'afterKeyClear') {
      await clickNamed('Add account', { query: 'account', required: false });
    }
    const wizard = await axOk(['snapshot', '--full']);
    const methods = ['Advanced', 'Credential', 'browser', 'Create', 'Import'].filter((name) =>
      includesText(wizard, name),
    );
    expect(methods.length >= 2, 'Fewer than two setup methods visible', compact(wizard));
    return { methods, preview: compact(wizard) };
  });
}

function finish() {
  const counts = { pass: 0, fail: 0, skip: 0, blocker: 0 };
  for (const row of report.steps) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  report.finishedAt = new Date().toISOString();
  report.counts = counts;
  report.ok = counts.fail === 0 && counts.blocker === 0;
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log('');
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Result: ${report.ok ? 'ALL CHECKS PASSED' : 'FAILURES RECORDED'}  ${JSON.stringify(counts)}`);
  return report.ok ? 0 : 1;
}

async function main() {
  console.log('AttentionX user-journey run');
  console.log(`Wipe first-login: ${!NO_WIPE}   only: ${onlyList ? onlyList.join(',') : '(all)'}`);
  console.log('');

  await journeySurfaces();
  await journeyCurrent();
  await journeyWipe();
  await journeyFirstLogin();
  await journeyDemo();
  await journeyCockpit();
  await journeyTimeline();
  await journeyLive();
  await journeyBindings();
  await journeyWizardMethods();
  await journeyAfterClear();

  process.exit(finish());
}

main().catch((error) => {
  record('runner', 'Journey runner crashed', 'fail', error instanceof Error ? error.stack : String(error));
  process.exit(finish());
});
