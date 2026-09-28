import type { AppMode } from '../shared/app-mode'
import { normalizeRelayList } from '../shared/relay-list'
import type { StorageRetentionSettings } from '../shared/storage-retention'
import type { SyncStrategy } from '../shared/sync-strategy'
import { normalizeRelayUrl } from '../shared/url'
import { DEMO_EVENT_STATE } from './demo-event-state'
import type { EventRecord, SignedNostrEvent, XIdentityRecord, XPostRecord } from './types'

export const LOCAL_DATA_EXPORT_FORMAT = 'attentionx-export'
export const LOCAL_DATA_EXPORT_VERSION = 1

export const EXPORT_FILES = {
  events: 'events.json',
  xIdentities: 'x-identities.json',
  xPosts: 'x-posts.json',
  settings: 'settings.json',
  manifest: 'manifest.json',
} as const

export interface RelayFlagExport {
  read: boolean
  write: boolean
}

/** Network screen lists. Missing flags stay omitted. */
export interface RelaySelectionExport {
  active: string[]
  inactive: string[]
  dismissed: string[]
  flags: Record<string, RelayFlagExport>
}

/** Stored background settings with secrets removed, plus the Network lists. */
export interface ExportedSettings {
  relays: string[]
  mode?: AppMode
  wotMaxDegree?: number
  followTrustRed?: number
  followTrustGreen?: number
  followTrustThreshold?: number
  syncIntervalMinutes?: number
  wotAutoLower?: boolean
  syncStrategy?: SyncStrategy
  externalProfilesEnabled?: boolean
  storageRetention?: StorageRetentionSettings
  relaySelection: RelaySelectionExport
}

export interface PortableTables {
  events: SignedNostrEvent[]
  xIdentities: XIdentityRecord[]
  xPosts: XPostRecord[]
  skippedDemo: number
}

export interface LocalDataExport extends PortableTables {
  exportedAt: number
  settings: ExportedSettings
}

export interface LocalDataExportManifest {
  format: typeof LOCAL_DATA_EXPORT_FORMAT
  version: typeof LOCAL_DATA_EXPORT_VERSION
  exportedAt: number
  counts: {
    events: number
    skippedDemo: number
    xIdentities: number
    xPosts: number
  }
}

export interface RelaySelectionInput {
  syncRelays: unknown
  inactiveRelays: unknown
  dismissedRelays: unknown
  relayFlags: unknown
}

interface SettingsSource {
  relays: readonly string[]
  mode?: AppMode
  wotMaxDegree?: number
  followTrustRed?: number
  followTrustGreen?: number
  followTrustThreshold?: number
  syncIntervalMinutes?: number
  wotAutoLower?: boolean
  syncStrategy?: SyncStrategy
  externalProfilesEnabled?: boolean
  storageRetention?: StorageRetentionSettings
  secretKeyHex?: string
}

/** Signed NIP-01 event. Demo rows are local-only and are omitted. */
export function toPortableEvent(record: EventRecord): SignedNostrEvent | undefined {
  if (record.state === DEMO_EVENT_STATE) return undefined
  return {
    id: record.id,
    pubkey: record.pubkey,
    created_at: record.created_at,
    kind: record.kind,
    tags: record.tags.map((tag) => [...tag]),
    content: record.content,
    sig: record.sig,
  }
}

export function portableTables(input: {
  events: readonly EventRecord[]
  xIdentities: readonly XIdentityRecord[]
  xPosts: readonly XPostRecord[]
}): PortableTables {
  const events: SignedNostrEvent[] = []
  let skippedDemo = 0
  for (const record of input.events) {
    const portable = toPortableEvent(record)
    if (!portable) {
      skippedDemo += 1
      continue
    }
    events.push(portable)
  }
  return {
    events,
    xIdentities: input.xIdentities.map((row) => structuredClone(row)),
    xPosts: input.xPosts.map((row) => structuredClone(row)),
    skippedDemo,
  }
}

export function relaySelectionFromStorage(
  input: RelaySelectionInput,
): RelaySelectionExport {
  return {
    active: urlsFromSync(input.syncRelays),
    inactive: urlsFromList(input.inactiveRelays),
    dismissed: urlsFromList(input.dismissedRelays),
    flags: flagsFromStorage(input.relayFlags),
  }
}

export function exportedSettings(
  settings: SettingsSource,
  relayStorage: RelaySelectionInput,
): ExportedSettings {
  return {
    relays: [...settings.relays],
    ...(settings.mode !== undefined ? { mode: settings.mode } : {}),
    ...(settings.wotMaxDegree !== undefined
      ? { wotMaxDegree: settings.wotMaxDegree }
      : {}),
    ...(settings.followTrustRed !== undefined
      ? { followTrustRed: settings.followTrustRed }
      : {}),
    ...(settings.followTrustGreen !== undefined
      ? { followTrustGreen: settings.followTrustGreen }
      : {}),
    ...(settings.followTrustThreshold !== undefined
      ? { followTrustThreshold: settings.followTrustThreshold }
      : {}),
    ...(settings.syncIntervalMinutes !== undefined
      ? { syncIntervalMinutes: settings.syncIntervalMinutes }
      : {}),
    ...(settings.wotAutoLower !== undefined
      ? { wotAutoLower: settings.wotAutoLower }
      : {}),
    ...(settings.syncStrategy !== undefined
      ? { syncStrategy: settings.syncStrategy }
      : {}),
    ...(settings.externalProfilesEnabled !== undefined
      ? { externalProfilesEnabled: settings.externalProfilesEnabled }
      : {}),
    ...(settings.storageRetention !== undefined
      ? { storageRetention: structuredClone(settings.storageRetention) }
      : {}),
    relaySelection: relaySelectionFromStorage(relayStorage),
  }
}

export function buildLocalDataExport(input: {
  exportedAt: number
  tables: PortableTables
  settings: SettingsSource
  relayStorage: RelaySelectionInput
}): LocalDataExport {
  return {
    exportedAt: input.exportedAt,
    ...input.tables,
    settings: exportedSettings(input.settings, input.relayStorage),
  }
}

export function localDataExportManifest(
  data: Pick<
    LocalDataExport,
    'exportedAt' | 'events' | 'skippedDemo' | 'xIdentities' | 'xPosts'
  >,
): LocalDataExportManifest {
  return {
    format: LOCAL_DATA_EXPORT_FORMAT,
    version: LOCAL_DATA_EXPORT_VERSION,
    exportedAt: data.exportedAt,
    counts: {
      events: data.events.length,
      skippedDemo: data.skippedDemo,
      xIdentities: data.xIdentities.length,
      xPosts: data.xPosts.length,
    },
  }
}

function urlsFromSync(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return normalizeRelayList(value.split(','))
}

function urlsFromList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return normalizeRelayList(
    value.filter((item): item is string => typeof item === 'string'),
  )
}

function flagsFromStorage(value: unknown): Record<string, RelayFlagExport> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const flags: Record<string, RelayFlagExport> = {}
  for (const [rawUrl, rawFlag] of Object.entries(value)) {
    const url = normalizeRelayUrl(rawUrl)
    if (!url || !isRelayFlag(rawFlag)) continue
    flags[url] = { read: rawFlag.read, write: rawFlag.write }
  }
  return flags
}

function isRelayFlag(value: unknown): value is RelayFlagExport {
  if (typeof value !== 'object' || value === null) return false
  const flag = value as { read?: unknown; write?: unknown }
  return typeof flag.read === 'boolean' && typeof flag.write === 'boolean'
}
