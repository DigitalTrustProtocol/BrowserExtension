/**
 * Thin AXI wrapper for user-journey scripts.
 * Always calls `node scripts/ax.mjs` (same debug Chrome on :9222).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const AX = path.join(ROOT, 'scripts', 'ax.mjs');

export function parseRefs(toon) {
  const refs = [];
  for (const line of String(toon).split(/\r?\n/)) {
    const match = line.match(/(@g\d+:\d+)/);
    if (!match) continue;
    refs.push({ id: match[1], line: line.trim() });
  }
  return refs;
}

export function findRef(toon, needle) {
  const want = String(needle).toLowerCase();
  return parseRefs(toon).find((row) => row.line.toLowerCase().includes(want)) ?? null;
}

export function findRefs(toon, needle) {
  const want = String(needle).toLowerCase();
  return parseRefs(toon).filter((row) => row.line.toLowerCase().includes(want));
}

export function parseEvalJson(toon) {
  const text = String(toon);
  const evalIndex = text.search(/^eval:/m);
  if (evalIndex < 0) return { raw: text, value: null };
  let payload = text.slice(evalIndex + 'eval:'.length).trim();
  const helpIndex = payload.search(/^help\[/m);
  if (helpIndex >= 0) payload = payload.slice(0, helpIndex).trim();
  if ((payload.startsWith('"') && payload.endsWith('"')) || (payload.startsWith("'") && payload.endsWith("'"))) {
    try {
      payload = JSON.parse(payload);
    } catch {
      /* keep quoted */
    }
  }
  if (typeof payload === 'object' && payload !== null) {
    return { raw: text, value: payload };
  }
  try {
    return { raw: text, value: JSON.parse(payload) };
  } catch {
    return { raw: text, value: typeof payload === 'string' && payload ? payload : null };
  }
}

export function includesText(toon, ...needles) {
  const hay = String(toon).toLowerCase();
  return needles.every((needle) => hay.includes(String(needle).toLowerCase()));
}

export async function ax(args, { timeoutMs = 60_000 } = {}) {
  const argv = args.map(String);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [AX, ...argv], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`AXI timed out: ax ${argv.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: code ?? 1,
        stdout,
        stderr,
        args: argv,
      });
    });
  });
}

export async function axOk(args, options) {
  const result = await ax(args, options);
  if (!result.ok) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').slice(0, 2000);
    throw new Error(`AXI failed (${result.code}): ax ${result.args.join(' ')}\n${detail}`);
  }
  return result.stdout;
}

export async function waitMs(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
