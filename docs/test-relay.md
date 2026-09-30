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
play
play stop
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
seed <file>
quit
```

Publish commands hit every running relay unless prefixed with `on <1-based index>`.

- `bulk` signs trust, rating, and profile events spread across `days`. The same seed, count, and persona count is cached under `.test-relay/cache`.
- `stream` emits trust, ratings, profiles, and replacements, mostly from the hub personas. A rate below 10/s waits out each event. `stream 1` is one event per second.
- `play` loads `scripts/data/x-identities.json` and `scripts/data/x-posts.json` (cockpit Users and Posts downloads; clear the page filter first). It replaces the demo subjects with those ids. The first events are the demo spine: You → Elon → SpaceX → Tesla → NASA, plus a few other direct trusts from You. You is signed with the `nsec` property on the Digital Trust Protocol row. Every other account gets a generated key. Elon is sent first. Then one kind 10011 per persona, then trickle, steady, pause, burst, fast, and flood. `play stop` ends it. A missing or empty posts file uses post `2104545486313247031`. Subscribe all does not request kind 10011; watch those with `received --kind 10011`.
- `churn` moves existing trust slots through trust, Neutral, distrust, and Delete.
- `storm` publishes a burst.
- `pathological` submits a bad signature, a non-`x.com` scope, a far-future `created_at`, an oversize event, a duplicate, and 250 events that share one `created_at`.
- `preset demo` publishes the demo WoT shape without the demo tag, signed so operator A is the root.
- `keys operator a|b` prints an nsec for import into the extension.
- `seed <file>` loads a JSON array of signed events, or `{ "events": [...] }`. Local fields such as `firstSeenAt` are ignored. Events are inserted oldest first so replacements and kind 5 deletions apply in order. Advanced Zone **Events → Download** writes `events.json` in this shape. A filter on that page limits the file; paging does not.

## Watch a live playback

Copy the cockpit downloads to `scripts/data/x-identities.json` and `scripts/data/x-posts.json`. Those files are gitignored.

1. Start the relay without `--no-verify`.
2. In the extension, use production mode and set Network to only `ws://127.0.0.1:7777`. Set Data Synchronization to **Subscribe all**.
3. Advanced → Admin → **Clear events and cursors**. That deletes events, sync cursors, and relay observations. Users, posts, the outbox, and keys stay. Wait until Subscribe all is live again. The new subscription starts at about now and does not backfill.
4. Put your active key's `nsec` on the Digital Trust Protocol row in `scripts/data/x-identities.json`. Other rows stay without one; those authors get generated keys.
5. In the relay console, `play`. The first event is You trusting Elon. The spine You → Elon → SpaceX → Tesla → NASA follows before the random phases.

Danger Zone → Delete cached data still clears identities and posts as well. Subscribe all listens for kind 32009 and 32014 only.

`play` phases: trickle (1 event every 2s for 30s), steady (5/s for 20s), pause 5s, burst of 80, pause 3s, fast (40/s for 8s), flood of 400. The flood is larger than the extension live queue, so the socket closes, flushes, and reconnects.

## Reload a browser export

1. In Advanced Zone, open **Events** and choose **Download**. That saves `events.json`.
2. `reset`, then `seed` the path to `events.json`.
3. In the extension, set Network to only `ws://127.0.0.1:7777`.
4. Danger Zone → **Delete cached data**. That keeps the vault and the relay list.
5. Data Synchronization → interval, then Sync now.

Interval sync reloads your own kind 32009 history and the positive `p` frontier. Subscribe all starts at now and does not backfill this file. **Users** and **Posts** each have their own Download button (`x-identities.json`, `x-posts.json`). Those names and headlines return when the accounts and posts are seen on X again.

Snapshots and the signed cache live under `.test-relay/` (gitignored).

Two browsers can both add `ws://127.0.0.1:7777` and remove their public relays. Give each browser its own test key (`keys operator a` and `keys operator b`).

## What it implements

NIP-01 `EVENT`, `REQ`, `CLOSE`, `EOSE`, `OK`, `NOTICE`, and `CLOSED`. Filters: `ids`, `authors`, `kinds`, `#` tags, `since`, `until`, `limit`. Results are newest first. Equal timestamps are ordered by ascending id.

Replaceable kinds (0, 3, 10000–19999) and addressable kinds (30000–39999, including 32009 and 32014) keep one winner. Ephemeral kinds are broadcast and not stored. Kind 5 deletes the author's own older events. `created_at` more than 15 minutes in the future is rejected. Signatures are checked unless `--no-verify` is set.
