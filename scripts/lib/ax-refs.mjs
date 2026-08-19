export const AX_REF_ATTR = 'data-ax-ref';
export const MCP_SERVER = 'playwright-debug';
export const MCP_CDP = 'http://127.0.0.1:9222';

export function formatRef(generation, n) {
  return `@g${generation}:${n}`;
}

export function axRefToken(generation, n) {
  return `g${generation}:${n}`;
}

export function axRefSelector(generation, n) {
  return `[${AX_REF_ATTR}="${axRefToken(generation, n)}"]`;
}

export function parseRef(token) {
  const value = String(token ?? '').trim();
  const prefixed = value.match(/^@g(\d+):(\d+)$/i);
  if (prefixed) {
    return { ok: true, generation: Number(prefixed[1]), n: Number(prefixed[2]), raw: value };
  }
  const plain = value.match(/^@(\d+)$/);
  if (plain) {
    return { ok: true, generation: null, n: Number(plain[1]), raw: value };
  }
  const kinded = value.match(/^@(c|s|p|b)(\d+)$/i);
  if (kinded) {
    const kindMap = { c: 'chip', s: 'star', p: 'post', b: 'button' };
    return {
      ok: true,
      generation: null,
      n: null,
      kind: kindMap[kinded[1].toLowerCase()],
      kindIndex: Number(kinded[2]),
      raw: value,
    };
  }
  return { ok: false, reason: `invalid ref \`${value}\` (expected @g1:3, @3, or @c1)` };
}
