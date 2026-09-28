/** Extension Display setting: Nostr mark on profile icons. Default on. */
export const SHOW_NOSTR_PROFILE_CHECK_KEY = 'attentionxShowNostrProfileCheck'

export function showNostrProfileCheckFromStorage(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true
}
