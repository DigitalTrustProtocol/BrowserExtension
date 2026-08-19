const INDENT = '  ';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function needsQuotes(value) {
  if (value === '') return true;
  if (/^(true|false|null)$/i.test(value)) return true;
  return /[:[\]{},\n\r\t"]/.test(value) || /^\s|\s$/.test(value) || value.includes('\\');
}

export function encodeString(value) {
  const text = String(value);
  if (!needsQuotes(text) && !text.includes('\n')) return text;
  return JSON.stringify(text);
}

function encodePrimitive(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return encodeString(value);
}

function allPrimitive(object) {
  return Object.values(object).every(
    (value) => value === null || ['string', 'number', 'boolean'].includes(typeof value),
  );
}

function encodeInlineObject(object) {
  const parts = Object.entries(object).map(
    ([key, value]) => `${key}: ${encodePrimitive(value)}`,
  );
  return `{${parts.join(', ')}}`;
}

function uniformKeys(rows) {
  if (rows.length === 0) return null;
  if (!rows.every((row) => isPlainObject(row))) return null;
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return null;
  return rows.every((row) => {
    const rowKeys = Object.keys(row);
    return rowKeys.length === keys.length && rowKeys.every((key, index) => key === keys[index]);
  })
    ? keys
    : null;
}

function encodeTabularRows(rows, keys, depth) {
  const pad = INDENT.repeat(depth);
  return rows
    .map((row) => `${pad}${keys.map((key) => encodePrimitive(row[key] ?? null)).join(',')}`)
    .join('\n');
}

function encodeArray(value, depth, key) {
  const pad = INDENT.repeat(depth);
  if (value.length === 0) {
    return `${key}[0]:`;
  }

  if (key === 'help' && value.every((item) => typeof item === 'string')) {
    const lines = value.map((item) => `${INDENT.repeat(depth + 1)}${item}`).join('\n');
    return `${key}[${value.length}]:\n${lines}`;
  }

  if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
    if (value.every((item) => typeof item !== 'string' || !item.includes('\n'))) {
      return `${key}[${value.length}]: ${value.map(encodePrimitive).join(',')}`;
    }
  }

  const keys = uniformKeys(value);
  if (keys && keys.length <= 8 && value.every(allPrimitive)) {
    const header = `${key}[${value.length}]{${keys.join(',')}}:`;
    return `${header}\n${encodeTabularRows(value, keys, depth + 1)}`;
  }

  const items = value
    .map((item) => {
      if (isPlainObject(item)) {
        const body = encodeObject(item, depth + 2);
        const first = Object.entries(item)[0];
        if (!first) return `${pad}${INDENT}- {}`;
        return `${pad}${INDENT}- ${body.trimStart()}`;
      }
      return `${pad}${INDENT}- ${encodePrimitive(item)}`;
    })
    .join('\n');
  return `${key}[${value.length}]:\n${items}`;
}

function encodeObject(object, depth) {
  const pad = INDENT.repeat(depth);
  const lines = [];
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const encoded = encodeArray(value, depth, key);
      lines.push(`${pad}${encoded}`);
      continue;
    }
    if (isPlainObject(value)) {
      if (Object.keys(value).length === 0) {
        lines.push(`${pad}${key}: {}`);
        continue;
      }
      if (allPrimitive(value) && Object.keys(value).length <= 6) {
        lines.push(`${pad}${key}: ${encodeInlineObject(value)}`);
        continue;
      }
      lines.push(`${pad}${key}:`);
      lines.push(encodeObject(value, depth + 1));
      continue;
    }
    lines.push(`${pad}${key}: ${encodePrimitive(value)}`);
  }
  return lines.join('\n');
}

/** Encode a JSON value as AXI-style TOON on stdout. */
export function encodeToon(value) {
  if (Array.isArray(value)) {
    return encodeArray(value, 0, 'items');
  }
  if (isPlainObject(value)) {
    return encodeObject(value, 0);
  }
  return encodePrimitive(value);
}

export function filterByQuery(items, query, haystack) {
  if (!query) return items;
  const tokens = String(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const hay = haystack(item).toLowerCase();
    return tokens.every((token) => hay.includes(token));
  });
}

export function truncateText(text, limit, full) {
  const value = String(text ?? '');
  if (full || value.length <= limit) {
    return { text: value, truncated: false, chars: value.length };
  }
  return {
    text: `${value.slice(0, limit)}... (truncated, ${value.length} chars total — use --full)`,
    truncated: true,
    chars: value.length,
  };
}
