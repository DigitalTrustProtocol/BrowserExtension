import { encodeToon } from './ax-toon.mjs';
import { DESCRIPTION, RUN, binPath, nextHelp } from './ax-help.mjs';
import { parseArgv } from './ax-parse.mjs';
import { VERSION } from './ax-version.mjs';

function print(doc) {
  console.log(encodeToon(doc));
}

function fail(error, helpLines, code = 1) {
  const doc = { error };
  if (helpLines?.length) doc.help = helpLines;
  print(doc);
  return code;
}

function succeed(doc, helpKind, extraHelp) {
  const hints = extraHelp?.length ? extraHelp : helpKind ? nextHelp(helpKind) : [];
  if (hints.length) doc.help = hints;
  print(doc);
  return 0;
}

function withHomeMeta(doc) {
  return {
    bin: binPath(),
    description: DESCRIPTION,
    version: VERSION,
    ...doc,
  };
}

export async function main(argv) {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    return fail(parsed.error, parsed.helpLines, parsed.code ?? 2);
  }

  const { command, rest, flags } = parsed;
  if (flags.help || flags.h) {
    console.log((await import('./ax-help.mjs')).formatHelp(command || undefined));
    return 0;
  }

  const browser = await import('./ax-browser.mjs');

  try {
    if (!command) {
      const result = await browser.cmdHome();
      if (!result.ok) {
        return fail(result.error, result.helpLines ?? nextHelp(result.help || 'error-cdp'), result.code ?? 1);
      }
      return succeed(withHomeMeta(result.doc), result.help);
    }

    let result;
    switch (command) {
      case 'go':
        result = await browser.cmdGo();
        break;
      case 'reload':
        result = await browser.cmdReload();
        break;
      case 'inspect':
        result = await browser.cmdInspect(flags);
        break;
      case 'tabs':
        result = await browser.cmdTabs(flags);
        break;
      case 'focus':
        result = await browser.cmdFocus(rest[0]);
        break;
      case 'x': {
        const sub = rest[0];
        if (!sub || sub === 'summary') result = await browser.cmdX(flags, 'summary');
        else if (sub === 'posts') result = await browser.cmdX(flags, 'posts');
        else if (sub === 'popover') result = await browser.cmdX(flags, 'popover');
        else if (sub === 'chip' || sub === 'star') {
          if (!rest[1]) {
            return fail(`${sub} requires a ref like @g1:3 or @c1`, [`Run \`${RUN} x ${sub} <ref>\``], 2);
          }
          result = await browser.cmdX(flags, sub, rest[1]);
        } else {
          return fail(`unknown x subcommand \`${sub}\``, [
            `valid x subcommands: posts, popover, chip <ref>, star <ref>`,
          ], 2);
        }
        break;
      }
      case 'popup':
        result = await browser.cmdPopup(flags);
        break;
      case 'cockpit':
        result = await browser.cmdCockpit(flags);
        break;
      case 'ext':
        result = await browser.cmdExt();
        break;
      case 'open':
        result = await browser.cmdOpen(rest[0], flags);
        break;
      case 'snapshot':
        result = await browser.cmdSnapshot(flags);
        break;
      case 'click':
        result = await browser.cmdClick(rest[0], flags);
        break;
      case 'fill':
        result = await browser.cmdFill(rest[0], rest.slice(1).join(' '), flags);
        break;
      case 'type':
        result = await browser.cmdType(rest.join(' '), flags);
        break;
      case 'press':
        result = await browser.cmdPress(rest[0], flags);
        break;
      case 'scroll':
        result = await browser.cmdScroll(rest[0], flags);
        break;
      case 'wait':
        result = await browser.cmdWait(rest.join(' '), flags);
        break;
      case 'eval':
        result = await browser.cmdEval(rest.join(' '), flags);
        break;
      case 'screenshot':
        result = await browser.cmdScreenshot(rest[0], flags);
        break;
      case 'mcp':
        result = await browser.cmdMcp();
        break;
      case 'setup':
        result = await browser.cmdSetup();
        break;
      default: {
        const _exhaustive = command;
        return fail(`unknown command \`${_exhaustive}\``, [`Run \`${RUN} --help\``], 2);
      }
    }

    if (!result.ok) {
      return fail(result.error, result.helpLines ?? nextHelp(result.help || ''), result.code ?? 1);
    }
    const doc = command === 'go' ? withHomeMeta(result.doc) : result.doc;
    return succeed(doc, result.help, result.helpLines);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, nextHelp('error-cdp'), 1);
  }
}
