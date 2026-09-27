export function getDomainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function isValidWssUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'wss:'; } catch { return false; }
}

/** `ws:` or `wss:` relay URL, including IP hosts and localhost. Trailing slash removed. */
export function normalizeRelayUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
  if (!url.hostname) return null;
  return url.toString().replace(/\/$/, '');
}

export function isValidHttpsUrl(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:'; } catch { return false; }
}
