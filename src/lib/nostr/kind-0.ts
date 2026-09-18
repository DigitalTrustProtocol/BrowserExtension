/**
 * Kind 0 metadata (NIP-01 profile). Optional `nip05` is a NIP-05 identifier.
 */

import { normalizeNip05Identifier } from './nip05'

export interface Kind0Metadata {
  name?: string
  display_name?: string
  about?: string
  picture?: string
  nip05?: string
  lud16?: string
  website?: string
  banner?: string
}

export interface XProfilePrefill {
  name?: string
  picture?: string
  banner?: string
  about?: string
  /** True when live X bio was read; empty about still overwrites. */
  aboutProvided?: boolean
}

function trim(value: string | undefined): string {
  return value?.trim() ?? ''
}

/**
 * Freeform editor: merge form fields into existing kind 0, deleting empties.
 */
export function buildKind0Metadata(
  existing: Kind0Metadata | null | undefined,
  fields: {
    name: string
    about: string
    picture: string
    nip05: string
    lud16: string
    website: string
    banner: string
    pictureUrl?: string | null
  },
): Kind0Metadata {
  const metadata: Kind0Metadata = existing ? { ...existing } : {}
  if (fields.name) metadata.name = fields.name
  else delete metadata.name
  if (fields.about) metadata.about = fields.about
  else delete metadata.about
  if (fields.pictureUrl) metadata.picture = fields.pictureUrl
  else if (fields.picture) metadata.picture = fields.picture
  else delete metadata.picture
  if (fields.nip05) {
    metadata.nip05 =
      normalizeNip05Identifier(fields.nip05) ?? fields.nip05.trim()
  } else delete metadata.nip05
  if (fields.lud16) metadata.lud16 = fields.lud16
  else delete metadata.lud16
  if (fields.website) metadata.website = fields.website
  else delete metadata.website
  if (fields.banner) metadata.banner = fields.banner
  else delete metadata.banner
  if (fields.name) metadata.display_name = fields.name
  return metadata
}

/**
 * X-prefill merge: overwrite X-supplied fields only. Never delete nip05/lud16/website.
 */
export function mergeKind0WithXPrefill(
  existing: Kind0Metadata | null | undefined,
  x: XProfilePrefill,
): Kind0Metadata {
  const metadata: Kind0Metadata = existing ? { ...existing } : {}
  const name = trim(x.name)
  if (name) {
    metadata.name = name
    metadata.display_name = name
  }
  const picture = trim(x.picture)
  if (picture) metadata.picture = picture
  const banner = trim(x.banner)
  if (banner) metadata.banner = banner
  if (x.aboutProvided) {
    const about = trim(x.about)
    if (about) metadata.about = about
  }
  return metadata
}

export function parseKind0Content(
  content: string,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** External cache stores display chrome only. */
export function externalKind0Display(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ['name', 'display_name', 'picture'] as const) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      out[key] = value.trim()
    }
  }
  return out
}
