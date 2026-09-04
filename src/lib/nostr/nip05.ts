/**
 * NIP-05 identifiers stored on kind 0 (`nip05`: `name@domain`).
 * DNS / `.well-known/nostr.json` lookup is not implemented here.
 */

const NIP05_IDENTIFIER = /^([a-z0-9-_.]+)@([a-z0-9.-]+\.[a-z]{2,})$/i

export interface Nip05Identifier {
  name: string
  domain: string
}

export function parseNip05Identifier(
  value: string,
): Nip05Identifier | undefined {
  const match = NIP05_IDENTIFIER.exec(value.trim())
  if (!match) return undefined
  return { name: match[1].toLowerCase(), domain: match[2].toLowerCase() }
}

export function serializeNip05Identifier(parts: Nip05Identifier): string {
  return `${parts.name}@${parts.domain}`
}

export function normalizeNip05Identifier(value: string): string | undefined {
  const parsed = parseNip05Identifier(value)
  return parsed ? serializeNip05Identifier(parsed) : undefined
}
