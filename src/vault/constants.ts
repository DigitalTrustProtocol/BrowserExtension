/**
 * Shared constants — timeouts and crypto parameters.
 * Ported from nostr-wot-extension (wallet timeouts omitted).
 */

export const SIGNER_REQUEST_TIMEOUT_MS = 120_000
export const MUTE_LIST_FETCH_TIMEOUT_MS = 8_000
export const NIP07_CALL_TIMEOUT_MS = 120_000
export const GET_PUBLIC_KEY_COOLDOWN_MS = 60_000
export const PBKDF2_ITERATIONS = 210_000
export const MIN_PASSWORD_LENGTH = 8
export const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000
export const ACTIVITY_LOG_MAX_PER_DOMAIN = 200
export const ACTIVITY_LOG_GLOBAL_MAX = 2000
export const DEFAULT_AUTO_LOCK_MS = 900_000
/** Re-export for callers that import vault constants. */
export { AUTO_LOCK_MAX_MS } from './auto-lock-bounds.ts'
export const VAULT_POLL_INTERVAL_MS = 500
export const ONBOARDING_PENDING_TTL_MS = 5 * 60 * 1000
/** Soft cap for a single Easy / roaming Sync entry (JSON bytes). */
export const MAX_ROAMING_ENTRY_BYTES = 5 * 1024
