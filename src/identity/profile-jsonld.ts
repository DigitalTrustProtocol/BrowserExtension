import { isXNumericId } from '../shared/observed-x-identity'

const MAX_PROFILE_HTML_BYTES = 1_500_000
const MAX_JSON_LD_SCRIPTS = 32
const MAX_JSON_DEPTH = 12
const MAX_JSON_CONTAINERS = 2_000
const MAX_KEYS_PER_OBJECT = 100
const MAX_ARRAY_ITEMS = 100

export function extractTwitterIdsFromProfileJsonLd(html: string): string[] {
  if (new TextEncoder().encode(html).byteLength > MAX_PROFILE_HTML_BYTES) {
    return []
  }

  const ids = new Set<string>()
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let scripts = 0
  let match: RegExpExecArray | null

  while (
    scripts < MAX_JSON_LD_SCRIPTS &&
    (match = scriptPattern.exec(html)) !== null
  ) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1] ?? '')) {
      continue
    }
    scripts += 1

    try {
      collectMainEntityIdentifiers(JSON.parse(match[2] ?? ''), ids)
    } catch {
      // Ignore malformed or unrelated public metadata.
    }
  }

  return [...ids]
}

function collectMainEntityIdentifiers(
  root: unknown,
  ids: Set<string>,
): void {
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ]
  let containers = 0

  while (stack.length > 0 && containers < MAX_JSON_CONTAINERS) {
    const item = stack.pop()
    if (!item || item.depth > MAX_JSON_DEPTH) continue

    if (Array.isArray(item.value)) {
      containers += 1
      const limit = Math.min(item.value.length, MAX_ARRAY_ITEMS)
      for (let index = limit - 1; index >= 0; index -= 1) {
        stack.push({ value: item.value[index], depth: item.depth + 1 })
      }
      continue
    }
    if (!isRecord(item.value)) continue
    containers += 1

    if ('mainEntity' in item.value) {
      collectIdentifierValues(item.value.mainEntity, ids, 0)
    }

    for (const child of Object.values(item.value).slice(0, MAX_KEYS_PER_OBJECT)) {
      stack.push({ value: child, depth: item.depth + 1 })
    }
  }
}

function collectIdentifierValues(
  value: unknown,
  ids: Set<string>,
  depth: number,
): void {
  if (depth > 5) return
  if (isXNumericId(value)) {
    ids.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 20)) {
      collectIdentifierValues(child, ids, depth + 1)
    }
    return
  }
  if (!isRecord(value)) return

  for (const key of ['identifier', 'value', '@value'] as const) {
    if (key in value) collectIdentifierValues(value[key], ids, depth + 1)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
