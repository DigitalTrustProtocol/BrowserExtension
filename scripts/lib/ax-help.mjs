import { fileURLToPath } from 'node:url';
import { VERSION } from './ax-version.mjs';

export const RUN = 'npm run ax --';
export const DESCRIPTION =
  'Read and operate x.com and the Attention extension on debug Chrome (port 9222)';

const GLOBAL_FLAGS = ['help', 'h', 'full', 'query', 'limit', 'fields', 'page', 'submit', 'x-only'];

export const COMMANDS = {
  go: {
    summary: 'Start debug Chrome, reload Attention from dist/, focus x.com',
    flags: [],
    usage: `${RUN} go`,
    examples: [`${RUN} go`],
  },
  reload: {
    summary: 'Reload the unpacked Attention card (no-op if Chrome is closed)',
    flags: [],
    usage: `${RUN} reload`,
    examples: [`${RUN} reload`],
  },
  inspect: {
    summary: 'Compact X + popup + cockpit + extension card in one call',
    flags: ['x-only'],
    usage: `${RUN} inspect [--x-only]`,
    examples: [`${RUN} inspect`, `${RUN} inspect --x-only`],
  },
  tabs: {
    summary: 'List open tabs in debug Chrome',
    flags: ['limit'],
    usage: `${RUN} tabs [--limit <n>]`,
    examples: [`${RUN} tabs`],
  },
  focus: {
    summary: 'Bring a surface to the front',
    flags: [],
    usage: `${RUN} focus <x|popup|cockpit|ext>`,
    examples: [`${RUN} focus x`, `${RUN} focus popup`],
  },
  x: {
    summary: 'X timeline extraction (chips, stars, posts, popover)',
    flags: ['query', 'limit', 'fields', 'full'],
    usage: `${RUN} x [posts|popover|chip <ref>|star <ref>]`,
    examples: [
      `${RUN} x`,
      `${RUN} x posts --query alice`,
      `${RUN} x chip @g1:3`,
    ],
  },
  popup: {
    summary: 'Open the Attention popup page and snapshot it',
    flags: ['query', 'limit', 'full'],
    usage: `${RUN} popup [--query <text>]`,
    examples: [`${RUN} popup`, `${RUN} popup --query trust`],
  },
  cockpit: {
    summary: 'Open the Application (cockpit) page and snapshot it',
    flags: ['page', 'query', 'limit', 'full'],
    usage: `${RUN} cockpit [--page <users|posts|events|outbox|cockpit|log|danger|admin>]`,
    examples: [`${RUN} cockpit`, `${RUN} cockpit --page users`],
  },
  ext: {
    summary: 'Extension card on chrome://extensions',
    flags: [],
    usage: `${RUN} ext`,
    examples: [`${RUN} ext`],
  },
  open: {
    summary: 'Navigate the current tab and snapshot',
    flags: ['query', 'limit', 'full'],
    usage: `${RUN} open <url> [--query <text>]`,
    examples: [`${RUN} open https://x.com/home --query chip`],
  },
  snapshot: {
    summary: 'Interactive refs on the focused page',
    flags: ['query', 'limit', 'full'],
    usage: `${RUN} snapshot [--query <text>] [--limit <n>] [--full]`,
    examples: [`${RUN} snapshot --query trust`],
  },
  click: {
    summary: 'Click a ref, then snapshot (optional --query)',
    flags: ['query', 'limit', 'full'],
    usage: `${RUN} click @<ref> [--query <text>]`,
    examples: [`${RUN} click @g1:3 --query popover`],
  },
  fill: {
    summary: 'Fill an input ref; --submit also presses Enter',
    flags: ['submit', 'query', 'limit', 'full'],
    usage: `${RUN} fill @<ref> <text> [--submit]`,
    examples: [`${RUN} fill @g1:2 "hello" --submit`],
  },
  type: {
    summary: 'Type text at the current focus',
    flags: ['query', 'full'],
    usage: `${RUN} type <text>`,
    examples: [`${RUN} type "hello"`],
  },
  press: {
    summary: 'Press a keyboard key',
    flags: ['query', 'full'],
    usage: `${RUN} press <key>`,
    examples: [`${RUN} press Enter`, `${RUN} press Escape`],
  },
  scroll: {
    summary: 'Scroll the focused page',
    flags: ['query', 'limit', 'full'],
    usage: `${RUN} scroll <up|down|top|bottom>`,
    examples: [`${RUN} scroll down`],
  },
  wait: {
    summary: 'Wait for milliseconds or visible text',
    flags: ['full'],
    usage: `${RUN} wait <ms|text>`,
    examples: [`${RUN} wait 1500`, `${RUN} wait Trust`],
  },
  eval: {
    summary: 'Evaluate JavaScript in the focused page',
    flags: ['full'],
    usage: `${RUN} eval <js>`,
    examples: [`${RUN} eval "document.title"`],
  },
  screenshot: {
    summary: 'Save a PNG (path only — never dumps pixels)',
    flags: ['full'],
    usage: `${RUN} screenshot [path]`,
    examples: [`${RUN} screenshot`],
  },
  mcp: {
    summary: 'How AXI shares debug Chrome with Playwright MCP playwright-debug',
    flags: [],
    usage: `${RUN} mcp`,
    examples: [`${RUN} mcp`],
  },
  setup: {
    summary: 'Show how agents should load this AXI (Cursor skill)',
    flags: [],
    usage: `${RUN} setup`,
    examples: [`${RUN} setup`],
  },
};

export function commandNames() {
  return Object.keys(COMMANDS);
}

export function flagsFor(command, subcommand) {
  const spec = COMMANDS[command];
  if (!spec) return [...GLOBAL_FLAGS];
  if (command === 'x' && (subcommand === 'chip' || subcommand === 'star')) {
    return [...spec.flags];
  }
  return [...spec.flags];
}

export function isKnownFlag(name) {
  return GLOBAL_FLAGS.includes(name);
}

export function formatHelp(command) {
  if (!command) {
    return [
      `bin: ${binPath()}`,
      `description: ${DESCRIPTION}`,
      `version: ${VERSION}`,
      'commands:',
      ...commandNames().map((name) => `  ${name}: ${COMMANDS[name].summary}`),
      `usage: ${RUN} <command> [--help]`,
    ].join('\n');
  }

  const spec = COMMANDS[command];
  if (!spec) {
    return `error: unknown command \`${command}\`\nhelp[1]:\n  Run \`${RUN} --help\``;
  }

  const flagList = spec.flags.length > 0 ? spec.flags.map((flag) => `--${flag}`).join(', ') : '(none)';
  return [
    `${command}: ${spec.summary}`,
    `usage: ${spec.usage}`,
    `flags: ${flagList} (--help always allowed)`,
    'examples:',
    ...spec.examples.map((example) => `  ${example}`),
  ].join('\n');
}

export function binPath() {
  const file = fileURLToPath(new URL('../ax.mjs', import.meta.url));
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const normalized = file.replace(/\\/g, '/');
  const homeNorm = home.replace(/\\/g, '/');
  if (homeNorm && normalized.toLowerCase().startsWith(homeNorm.toLowerCase())) {
    return `~${normalized.slice(homeNorm.length)}`;
  }
  return normalized;
}

export function renamedFlagHint(name) {
  if (name === 'status') return '--status was renamed; use --query or a subcommand instead';
  if (name === 'url') return '--url is not a flag; pass the URL as `open <url>`';
  if (name === 'json') return '--json is not supported; output is TOON (use --full for untruncated text)';
  return null;
}

export function skillBody() {
  return [
    `bin: ${binPath()}`,
    `description: ${DESCRIPTION}`,
    'prefer:',
    `  ${RUN}                live dashboard (content-first)`,
    `  ${RUN} go             start debug Chrome + reload + focus X`,
    `  ${RUN} x              X timeline aggregates`,
    `  ${RUN} x posts        visible posts with chip/star refs`,
    `  ${RUN} x chip <ref>   open a chip and return the popover`,
    `  ${RUN} popup          extension popup snapshot`,
    `  ${RUN} cockpit        Application page snapshot`,
    `  ${RUN} snapshot --query <text>`,
    `  ${RUN} click @<ref> --query <text>`,
    `  ${RUN} mcp            Playwright MCP contract (same Chrome)`,
    'mcp: project server playwright-debug on :9222. Never the isolated Playwright plugin. Never browser_close.',
  ].join('\n');
}

export function nextHelp(kind, extra = {}) {
  switch (kind) {
    case 'home-up':
      return [
        `Run \`${RUN} x\` for timeline extraction`,
        `Playwright MCP: server playwright-debug on :9222 — never the isolated plugin, never browser_close`,
      ];
    case 'go':
      return [
        `Run \`${RUN} x\``,
        `MCP snapshots are stale after go — new snapshot or \`${RUN} x\``,
      ];
    case 'refs':
      return [
        `Run \`${RUN} click @<ref> --query <text>\``,
        `Playwright MCP playwright-debug: browser_click target [data-ax-ref="gN:M"] (same Chrome)`,
      ];
    case 'mcp':
      return [
        `Run \`${RUN} snapshot --query <text>\` then click AXI @refs or MCP [data-ax-ref]`,
        `After MCP actions, run \`${RUN} snapshot\` before AXI clicks`,
      ];
    case 'home-down':
      return [`Run \`${RUN} go\` to start debug Chrome and reload Attention`];
    case 'x':
      return [`Run \`${RUN} x posts\``, `Run \`${RUN} x chip <ref>\` to open a chip popover`];
    case 'x-posts':
      return [`Run \`${RUN} x chip <ref>\``, `Run \`${RUN} snapshot --query chip\``];
    case 'x-empty':
      return [`Run \`${RUN} go\` if no X tab is open`, `Run \`${RUN} wait 2000\` then \`${RUN} x\` after scroll`];
    case 'popup':
      return [`Run \`${RUN} click @<ref>\``, `Run \`${RUN} snapshot --query <text>\``];
    case 'cockpit':
      return [`Run \`${RUN} cockpit --page <id>\``, `Run \`${RUN} click @<ref>\``];
    case 'error-cdp':
      return [`Run \`${RUN} go\` to start debug Chrome on port 9222`];
    case 'stale':
      return [`Run \`${RUN} snapshot\` (or \`${RUN} x\`) to refresh refs`];
    case 'truncated':
      return extra.command ? [`Run \`${extra.command} --full\` to see complete text`] : [];
    default:
      return [];
  }
}
