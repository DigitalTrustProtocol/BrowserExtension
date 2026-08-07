/**
 * Shared domain types for AttentionX vault / NIP-07 (ported from nostr-wot-extension).
 */

// ── Nostr Events ──

export interface UnsignedEvent {
  pubkey?: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

export interface SignedEvent extends UnsignedEvent {
  id: string
  pubkey: string
  sig: string
}

// ── Accounts ──

export type AccountType = 'generated' | 'nsec' | 'npub' | 'nip46' | 'external'

export interface Nip46Config {
  bunkerUrl: string
  relay: string | null
  secret: string | null
  localPrivkey?: string
  localPubkey?: string
}

export interface Account {
  id: string
  name: string
  type: AccountType
  pubkey: string
  privkey: string | null
  mnemonic: string | null
  nip46Config: Nip46Config | null
  readOnly: boolean
  createdAt: number
  derivationIndex?: number
  /**
   * Numeric X user id this vault account is bound to (1↔1 operator binding).
   * Null when unbound (NIP-07-only / not yet linked to an X login).
   */
  boundTwitterId?: string | null
  /** Epoch ms when boundTwitterId last changed; used for Sync↔local merge. */
  boundUpdatedAt?: number | null
}

/** Account without private key — safe to expose */
export type SafeAccount = Omit<Account, 'privkey' | 'mnemonic'>

/** Account with private key as Uint8Array — used in vault memory only */
export interface MemoryAccount extends Omit<Account, 'privkey' | 'mnemonic'> {
  privkeyBytes: Uint8Array | null
  mnemonicBytes: Uint8Array | null
}

/** Vault payload with Uint8Array keys — in-memory only */
export interface MemoryVaultPayload {
  accounts: MemoryAccount[]
  activeAccountId: string | null
}

// ── Vault ──

export interface VaultPayload {
  accounts: Account[]
  activeAccountId: string | null
}

// ── Permissions ──

export type PermissionDecision = 'allow' | 'deny' | 'ask'

export type PermissionBucket = Record<string, PermissionDecision>

export type DomainPermissions = Record<string, PermissionBucket>

export type PermissionMap = Record<string, DomainPermissions>

// ── Signer ──

export interface PendingRequest {
  id: string
  type: string
  origin: string
  pubkey?: string
  event?: Partial<UnsignedEvent>
  theirPubkey?: string
  permKey?: string | null
  eventKind?: number
  needsPermission?: boolean
  waitingForUnlock?: boolean
  nip46InFlight?: boolean
  accountId?: string | null
  timestamp: number
}

export interface RequestDecision {
  allow: boolean
  remember?: boolean
  rememberKind?: boolean
  reason?: string
}

// ── i18n ──

export interface SupportedLanguage {
  code: string
  name: string
  native: string
  flag: string
  prompt: string
}

// ── Relay / liveQuery ──

export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  '#e'?: string[]
  '#p'?: string[]
  since?: number
  until?: number
  limit?: number
}

export type LiveEvent =
  | { type: 'event'; event: SignedEvent; source: 'local' | 'relay'; relay?: string }
  | { type: 'update'; event: SignedEvent; supersedes: string }
  | { type: 'delete'; eventId: string }
  | { type: 'eose'; relay: string }
  | { type: 'exhausted' }

export interface LiveQueryOptions {
  closeOnExhaust?: boolean
  cache?: boolean
  _createSocket?: (url: string) => WebSocket
}
