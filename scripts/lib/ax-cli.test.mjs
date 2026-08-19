import { describe, expect, it } from 'vitest';
import { encodeToon, filterByQuery, truncateText } from './ax-toon.mjs';
import { parseArgv } from './ax-parse.mjs';
import { parseRef, formatRef, axRefSelector, AX_REF_ATTR } from './ax-refs.mjs';

describe('encodeToon', () => {
  it('uses tabular form for uniform object arrays', () => {
    const text = encodeToon({
      count: '2 of 2 total',
      posts: [
        { id: '@p1', handle: 'alice', chip: 'Trust', star: '' },
        { id: '@p2', handle: 'bob', chip: 'Neutral', star: '3' },
      ],
    });
    expect(text).toContain('posts[2]{id,handle,chip,star}:');
    expect(text).toContain('@p1,alice,Trust,""');
    expect(text).toContain('@p2,bob,Neutral,3');
    expect(text).toContain('count: 2 of 2 total');
  });

  it('prints help lines without JSON braces', () => {
    const text = encodeToon({
      chrome: 'up',
      help: ['Run `npm run ax -- x`', 'Run `npm run ax -- popup`'],
    });
    expect(text).toContain('help[2]:');
    expect(text).toContain('  Run `npm run ax -- x`');
    expect(text).not.toContain('{');
  });
});

describe('filterByQuery', () => {
  const refs = [
    { role: 'button', name: 'Trust @alice', kind: 'chip' },
    { role: 'link', name: 'Home', kind: 'link' },
  ];

  it('keeps AND matches', () => {
    expect(filterByQuery(refs, 'trust chip', (row) => `${row.role} ${row.name} ${row.kind}`)).toEqual([
      refs[0],
    ]);
  });

  it('returns empty list when nothing matches', () => {
    expect(filterByQuery(refs, 'cockpit', (row) => `${row.role} ${row.name} ${row.kind}`)).toEqual([]);
  });
});

describe('truncateText', () => {
  it('adds --full hint when truncated', () => {
    const result = truncateText('abcdefghij', 4, false);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('use --full');
    expect(result.chars).toBe(10);
  });
});

describe('parseArgv', () => {
  it('treats no args as the home command', () => {
    expect(parseArgv([])).toMatchObject({ ok: true, command: '', rest: [] });
  });

  it('rejects unknown flags loud with the command flag list', () => {
    const result = parseArgv(['x', '--stat', 'closed']);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(2);
    expect(result.error).toContain('unknown flag --stat');
    expect(result.helpLines?.[0]).toContain('--query');
  });

  it('aliases navigate to open', () => {
    expect(parseArgv(['navigate', 'https://x.com/home'])).toMatchObject({
      ok: true,
      command: 'open',
      rest: ['https://x.com/home'],
    });
  });

  it('accepts the mcp command', () => {
    expect(parseArgv(['mcp'])).toMatchObject({ ok: true, command: 'mcp', rest: [] });
  });

  it('requires a value for --query', () => {
    const result = parseArgv(['snapshot', '--query']);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(2);
    expect(result.error).toContain('--query requires a value');
  });
});

describe('parseRef', () => {
  it('parses generation, plain, and kinded refs', () => {
    expect(parseRef('@g2:3')).toMatchObject({ ok: true, generation: 2, n: 3 });
    expect(parseRef('@3')).toMatchObject({ ok: true, generation: null, n: 3 });
    expect(parseRef('@c1')).toMatchObject({ ok: true, kind: 'chip', kindIndex: 1 });
    expect(parseRef('g2:3').ok).toBe(false);
  });

  it('formats generation refs', () => {
    expect(formatRef(4, 9)).toBe('@g4:9');
    expect(axRefSelector(4, 9)).toBe(`[${AX_REF_ATTR}="g4:9"]`);
  });
});
