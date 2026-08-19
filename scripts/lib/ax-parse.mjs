import {
  COMMANDS,
  RUN,
  commandNames,
  flagsFor,
  formatHelp,
  renamedFlagHint,
} from './ax-help.mjs';

const VALUE_FLAGS = new Set(['query', 'limit', 'fields', 'page']);
const BOOL_FLAGS = new Set(['help', 'h', 'full', 'submit', 'x-only']);
const ALWAYS_FLAGS = new Set(['help', 'h']);

const ALIASES = {
  navigate: 'open',
  ls: 'tabs',
  'reload-extension': 'reload',
};

function splitFlag(token) {
  const eq = token.indexOf('=');
  if (eq === -1) return { name: token.slice(2), value: undefined };
  return { name: token.slice(2, eq), value: token.slice(eq + 1) };
}

export function parseArgv(argv) {
  const flags = {};
  const positionals = [];
  const unknown = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const { name, value } = splitFlag(token);
      if (BOOL_FLAGS.has(name)) {
        if (value === 'false') flags[name] = false;
        else flags[name] = true;
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        const next = value !== undefined ? value : argv[i + 1];
        if (value === undefined) {
          if (!next || next.startsWith('-')) {
            return {
              ok: false,
              code: 2,
              error: `--${name} requires a value`,
              helpLines: [`Run \`${RUN} <command> --help\``],
            };
          }
          i += 1;
        }
        flags[name] = value !== undefined ? value : next;
        continue;
      }
      unknown.push(name);
      if (value === undefined && argv[i + 1] && !argv[i + 1].startsWith('-')) i += 1;
      continue;
    }
    if (token === '-h') {
      flags.help = true;
      continue;
    }
    if (token.startsWith('-') && token !== '-') {
      unknown.push(token);
      continue;
    }
    positionals.push(token);
  }

  let command = positionals[0] || '';
  if (ALIASES[command]) command = ALIASES[command];
  const rest = positionals.slice(1);

  if (unknown.length > 0 && command && COMMANDS[command]) {
    const name = unknown[0];
    const renamed = renamedFlagHint(name);
    const allowed = flagsFor(command, rest[0]).filter((flag) => !ALWAYS_FLAGS.has(flag));
    return {
      ok: false,
      code: 2,
      error: renamed || `unknown flag --${name} for \`${command}\``,
      helpLines: [
        `valid flags for \`${command}\`: ${allowed.length ? allowed.map((flag) => `--${flag}`).join(', ') : '(none)'} (--help always allowed)`,
      ],
    };
  }

  if (unknown.length > 0 && !command) {
    const name = unknown[0];
    return {
      ok: false,
      code: 2,
      error: `unknown flag --${name}`,
      helpLines: [`Run \`${RUN} --help\``],
    };
  }

  if (command && !COMMANDS[command] && command !== '') {
    const hint =
      command === 'navigate'
        ? `use \`${RUN} open <url>\``
        : `Run \`${RUN} --help\``;
    return {
      ok: false,
      code: 2,
      error: `unknown command \`${positionals[0]}\``,
      helpLines: [hint],
    };
  }

  if (command && COMMANDS[command]) {
    const sub = rest[0];
    const allowed = new Set([...flagsFor(command, sub), ...ALWAYS_FLAGS]);
    for (const name of Object.keys(flags)) {
      if (!allowed.has(name)) {
        const renamed = renamedFlagHint(name);
        const listed = [...allowed].filter((flag) => !ALWAYS_FLAGS.has(flag));
        return {
          ok: false,
          code: 2,
          error: renamed || `unknown flag --${name} for \`${command}\``,
          helpLines: [
            `valid flags for \`${command}\`: ${listed.length ? listed.map((flag) => `--${flag}`).join(', ') : '(none)'} (--help always allowed)`,
          ],
        };
      }
    }
  }

  return { ok: true, command, rest, flags };
}

export function helpText(command) {
  return formatHelp(command || undefined);
}

export { commandNames, RUN };
