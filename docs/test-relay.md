# Local Nostr test relay

A localhost-only relay for load, publish, and live-event tests. It is not a public relay. It binds to `127.0.0.1` and does not authenticate clients.

Network settings accept `ws://` and `wss://`, including IP addresses and localhost. Extension pages may connect to `ws:` and `http:` as well as `wss:` and `https:` so a local relay can be added and probed. Add `ws://127.0.0.1:7777` in the box between the active and inactive lists. Turn off the public relays if this process should be the only one the extension talks to.

Use a **test key**. `keys operator a` prints an nsec. Do not import that key into a profile that also publishes to the public network.

## Start

```bash
npm run relay
npm run relay -- --port 7777 --relays 2 --seed attentionx
npm run relay -- --no-verify
```

`--relays 2` starts independent relays on 7777 and 7778. `--no-verify` skips signature checks for a large bulk load.

The console prompt is `relay>`. The same commands are HTTP on that port:

| Method | Path | Body / query |
|--------|------|----------------|
| GET | `/` | NIP-11 document |
| POST | `/admin/command` | `{ "line": "bulk 1000" }` |
| GET | `/admin/stats` | |
| GET | `/admin/received` | `author`, `kind`, `tag`, `limit` |
| GET | `/admin/wait` | `author`, `kind`, `tag`, `timeout`, `fresh=1` |

## Commands

```text
help
stats
subs
received [--author <hex>] [--kind <n>] [--limit <n>]
personas [count]
keys operator a|b
subjects
subjects add user:<id>|post:<id>
subjects import <file>
bind <persona> <handle> <twitterId>
graph
root [a|b]
bulk <count> [days]
stream <perSecond> [seconds]
stream stop
churn [count]
storm <count>
pathological
preset demo
fault latency <ms> | drop <seconds> | down <seconds> | reject <percent>
fault eose-delay <ms> | no-eose [off] | rate-limit <perSecond> | clear
on <relay> <command>
reset
save [dir]
load [dir]
quit
```

Publish commands hit every running relay unless prefixed with `on <1-based index>`.

- `bulk` signs trust, rating, and profile events spread across `days`. The same seed, count, and persona count is cached under `.test-relay/cache`.
- `stream` emits trust, ratings, profiles, and replacements, mostly from the hub personas.
- `churn` moves existing trust slots through trust, Neutral, distrust, and Delete.
- `storm` publishes a burst.
- `pathological` submits a bad signature, a non-`x.com` scope, a far-future `created_at`, an oversize event, a duplicate, and 250 events that share one `created_at`.
- `preset demo` publishes the demo WoT shape without the demo tag, signed so operator A is the root.
- `keys operator a|b` prints an nsec for import into the extension.

Snapshots and the signed cache live under `.test-relay/` (gitignored).

Two browsers can both add `ws://127.0.0.1:7777` and remove their public relays. Give each browser its own test key (`keys operator a` and `keys operator b`).

## What it implements

NIP-01 `EVENT`, `REQ`, `CLOSE`, `EOSE`, `OK`, `NOTICE`, and `CLOSED`. Filters: `ids`, `authors`, `kinds`, `#` tags, `since`, `until`, `limit`. Results are newest first. Equal timestamps are ordered by ascending id.

Replaceable kinds (0, 3, 10000–19999) and addressable kinds (30000–39999, including 32009 and 32014) keep one winner. Ephemeral kinds are broadcast and not stored. Kind 5 deletes the author's own older events. `created_at` more than 15 minutes in the future is rejected. Signatures are checked unless `--no-verify` is set.
