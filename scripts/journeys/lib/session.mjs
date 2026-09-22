import { axOk, findRef, parseEvalJson, waitMs } from './ax.mjs';

const PROBE_JS = `(async () => {
  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(r);
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  const pick = (res) => (res && res.ok ? res.data : { error: res && res.error ? res.error : res });
  const session = pick(await send({ type: 'GET_PANEL_SESSION' }));
  const mode = pick(await send({ type: 'GET_APP_MODE', version: 1 }));
  const demo = pick(await send({ type: 'GET_DEMO_WOT_STATUS', version: 1 }));
  const state = pick(await send({ type: 'GET_STATE' }));
  const x = pick(await send({ type: 'GET_ACTIVE_X_ACCOUNT', version: 1 }));
  const bindings = pick(await send({ type: 'GET_OPERATOR_X_BINDINGS', version: 1 }));
  return {
    route: session && session.route,
    appMode: (session && session.appMode) || (mode && mode.mode) || mode,
    justWorksDemoPending: session && session.justWorksDemoPending,
    justWorksFailed: session && session.justWorksFailed,
    lifecycle: session && session.lifecycle,
    vault: session && session.vault,
    x: session && session.x,
    binding: session && session.binding,
    site: session && session.site && { kind: session.site.kind, isX: session.site.isX, domain: session.site.domain },
    demoEvents: demo && demo.eventCount,
    hasIdentity: state && state.hasIdentity,
    vaultLocked: state && state.vaultLocked,
    npub: state && state.npub ? String(state.npub).slice(0, 16) : null,
    cachedEventCount: state && state.cachedEventCount,
    activeX: x && { twitterId: x.twitterId || x.id, handle: x.handle },
    bindings: Array.isArray(bindings)
      ? bindings.slice(0, 8).map((row) => ({
          twitterId: row.twitterId,
          handle: row.handle,
          bound: Boolean(row.accountId || row.pubkey || row.bound),
        }))
      : bindings,
  };
})()`

const DELETE_JS = (mode) => `(async () => {
  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(r);
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  return await send({ type: 'DELETE_USER_DATA', version: 1, mode: ${JSON.stringify(mode)} });
})()`

async function recoverChrome() {
  await axOk(['go'], { timeoutMs: 120_000 });
  await waitMs(800);
}

export async function openPopup() {
  try {
    return await axOk(['popup'], { timeoutMs: 45_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Timeout|failed to open|serviceworker/i.test(message)) throw error;
    await recoverChrome();
    return axOk(['popup'], { timeoutMs: 45_000 });
  }
}

export async function openCockpit(page) {
  return page
    ? axOk(['cockpit', '--page', page], { timeoutMs: 45_000 })
    : axOk(['cockpit'], { timeoutMs: 45_000 });
}

export async function probeSession() {
  await openPopup();
  const raw = await axOk(['eval', PROBE_JS, '--full'], { timeoutMs: 30_000 });
  const parsed = parseEvalJson(raw);
  if (!parsed.value || typeof parsed.value !== 'object') {
    throw new Error(`Session probe did not return JSON: ${String(raw).slice(0, 800)}`);
  }
  return { raw, probe: parsed.value };
}

export async function pollSession(predicate, { timeoutMs = 20_000, intervalMs = 1000, label = 'session' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await probeSession();
    if (predicate(last.probe)) return last;
    await waitMs(intervalMs);
  }
  const seen = last?.probe ? JSON.stringify(last.probe) : last?.raw?.slice(0, 400);
  throw new Error(`Timed out waiting for ${label}. Last probe: ${seen}`);
}

export async function clickNamed(name, { query = name, required = true } = {}) {
  const snap = await axOk(['snapshot', '--query', query, '--full']);
  const ref = findRef(snap, name) || findRef(snap, query);
  if (!ref) {
    if (!required) return { clicked: false, snap };
    throw new Error(`No AXI ref matching "${name}" in:\n${snap.slice(0, 1500)}`);
  }
  const after = await axOk(['click', ref.id, '--query', query]);
  return { clicked: true, ref: ref.id, snap: after };
}

export async function fillNamed(name, text, { query = name, submit = false } = {}) {
  const snap = await axOk(['snapshot', '--query', query, '--full']);
  const ref = findRef(snap, name) || findRef(snap, 'textbox') || findRef(snap, 'input');
  if (!ref) throw new Error(`No AXI fill target matching "${name}" in:\n${snap.slice(0, 1500)}`);
  const args = ['fill', ref.id, text];
  if (submit) args.push('--submit');
  const after = await axOk(args);
  return { ref: ref.id, snap: after };
}

export async function deleteUserData(mode) {
  await openCockpit('danger');
  const raw = await axOk(['eval', DELETE_JS(mode), '--full']);
  return parseEvalJson(raw).value;
}

export async function ensureXHome() {
  return axOk(['open', 'https://x.com/home'], { timeoutMs: 60_000 });
}
