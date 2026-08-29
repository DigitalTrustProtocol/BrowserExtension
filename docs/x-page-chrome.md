# X.com page chrome

AttentionX injects trust chrome onto **users and posts the reader is already looking at** on x.com. Chrome is chosen from a small catalog of **distinct presets**, not invented per route. Routes only decide which X host is on screen.

X lays out **display name and handle differently by location** (timeline `User-Name` row vs Who to follow vs profile hero vs wide lists). AttentionX follows that: **atoms** (chip, underline, score/degree, dialog) are shared; **mount slots are not**. Do not reuse Who to follow (UserRail) placement for timeline UserAuthor, or UserAuthor for UserHero, and so on.

On-page chrome is separate from persisted `xIdentities` / `xPosts` display fields and from operator chrome (popup AccountBar). See [architecture.md § X content first](architecture.md#x-content-first-display-chrome).

## X shell

Typical logged-in desktop layout:

| Region | `data-testid` / path | What it shows |
|--------|----------------------|----------------|
| Left nav | `AppTabBar_*` | Home `/home`, Explore `/explore`, Notifications `/notifications`, Follow `/i/connect_people`, DMs `/i/chat`, Grok `/i/grok`, History `/i/history`, Profile `/<handle>` |
| Primary column | `primaryColumn` | The page’s main feed, list, or header |
| Right rail | `sidebarColumn` | Who to follow, Relevant people, trends |

Timeline rows sit in a virtualizer: `[data-testid="cellInnerDiv"]`. Tweet posts are `article[data-testid="tweet"]`. Account suggestion/list rows are `[data-testid="UserCell"]` and **do not** use `[data-testid="User-Name"]`.

Live nav note (2026-08): Bookmarks live under **History** (`/i/history`, tabs Bookmarks / Likes). `/i/bookmarks` still exists as a classifier alias. DMs are `/i/chat`, not only `/messages`.

## Host primitives

| Host | How X renders it | AttentionX chrome |
|------|------------------|-------------------|
| Tweet article | `article[data-testid="tweet"]` with `User-Name`, action bar | **UserAuthor** + **PostFeed** |
| Profile header | `UserName` + Follow/Edit | **UserHero** |
| Wide UserCell | Search People, Followers, Connect People — name, handle, bio, Follow | **UserRow** |
| Narrow UserCell | Who to follow, sidebar Relevant people, in-timeline / profile **You might like** (`button` UserCell, no bio) | **UserRail** |
| HoverCard | `[data-testid="HoverCard"]` | **UserHover** |
| Notification row | `[data-testid="notification"]` — avatars + excerpt, often **no** article | **UserNotice** (later) |
| Nested quote | `[data-testid="quoteTweet"]` inside an article | **PostQuote** (later) |

`UserCell` action buttons embed the numeric id: `data-testid="<twitterId>-follow"` / `-unfollow`, or `-subscribe` / `-unsubscribe` on creator Connect People (`?is_creator_only=true`).

## User chrome catalog

Define **User chromes** once; pick one per visible account.

| Chrome | Density | Pieces | Host | Reuse on |
|--------|---------|--------|------|----------|
| **UserHero** | richest user | Ambient on name + score and chip last on the name line after verified/affiliation icons | Profile header (`UserName`) | `/<handle>` and profile tabs that still show the hero |
| **UserAuthor** | feed | Ambient + compact score + chip last on that tweet’s `User-Name` row (after @handle / time) | `article` `[data-testid="User-Name"]` | Home, Explore posts, Search Top/Latest/Media, History, Lists, Community posts, profile tweets, status + replies |
| **UserRow** | list | Ambient + compact score (`Trusted · n°`) + chip last on the name line after verified/affiliation icons | Wide `UserCell` with bio / room beside Follow | Search People, Followers/Following, `/i/connect_people`, list members |
| **UserRail** | narrow | **Ambient underline + degree (`n°`) only. No chip.** Degree is the click target. Unknown/none: no underline, no degree; HoverCard still works | Tight `UserCell`: name fills the row next to Follow | Home **Who to follow** rail, in-timeline Who-to-follow module, Explore/profile Relevant people / sidebar suggestions |
| **UserHover** | overlay | HoverCard trust strip | `[data-testid="HoverCard"]` | Any page X shows a hovercard (fallback when UserRail has no chip) |
| **UserNotice** | later | Compact actor chips on avatars | `[data-testid="notification"]` | Notifications All (likes/follows) |

Atoms (chip, ambient underline, score/degree label, trust dialog) are shared. A chrome is a **preset of atoms + that host’s mount slot**. Do not copy a slot from another chrome because the atoms look similar.

### Mount slots follow X’s name/handle layout

| Chrome | How X draws name / handle here | AttentionX slot |
|--------|--------------------------------|-----------------|
| **UserAuthor** | Timeline `User-Name`: display name (+ verified) then `@handle` · time; Grok/more often sit as siblings | Last on the `User-Name` row, after handle/time — `ensureAuthorNameMetaMount`. Never `placeAfterDisplayNameIcons`. |
| **UserHero** | Profile `UserName`: large display name + verified; handle on another row | Last on the display-name line after verified/affiliation icons |
| **UserRow** | Wide `UserCell`: display name (+ verified), handle and bio below | Last on the display-name line after verified icons — `placeAfterDisplayNameIcons`. Compact score + chip (timeline pieces, Connect People slot). |
| **UserRail** | Tight `UserCell`: display name fills the row next to Follow; handle often below or truncated | Degree after display name + verified icons. No chip. Not the timeline slot. |

Pick **UserRail vs UserRow** from layout, not URL:

- `UserCell` inside `[data-testid="sidebarColumn"]` → **UserRail**
- Name+Follow card with no bio (Who to follow, profile **You might like** — often a `<button>` UserCell) → **UserRail**
- Primary-column list **with bio** → **UserRow**, including `/i/connect_people` and `?is_creator_only=true`. Those rows are also `<button>` UserCells; the host tag does not pick chrome.

### Who to follow (canonical UserRail)

Home right rail: a few `UserCell`s, display name consumes the column, Follow on the right. A chip would collide or wrap.

- Color underline on the display-name leaf (solid / dashed / double by tone)
- Degree only (`1°`, `2°`) last on the name line — after the display name and verified/affiliation icons, `flex: 0 0 auto` — not “Trusted · 1°”
- No brand chip
- “Show more” → `/i/connect_people` is a wide list → **UserRow** (score + chip on the name line)

## Post chrome catalog

| Chrome | Pieces | Host | Reuse on |
|--------|--------|------|----------|
| **PostFeed** | Star + gutter + post ambient | Tweet `article` | Same surfaces as UserAuthor |
| **PostQuote** (later) | Nested compact user+post | `[data-testid="quoteTweet"]` | Quotes inside PostFeed |
| **PostNotice** (later) | Optional excerpt rating if a post id is known | Notification snippet | With UserNotice |

**UserAuthor + PostFeed** together are the timeline article chrome. Do not fork a third timeline-only user UI.

## Surface map

| Path | Hosts | Chrome |
|------|-------|--------|
| `/home` feed | Tweet articles | UserAuthor + PostFeed |
| `/home` Who to follow | Sidebar `UserCell` | UserRail |
| `/explore` | Articles + trends + UserCells | UserAuthor+PostFeed; UserRail in rail; ignore trends |
| `/notifications` All | Notification cells (often no article) | UserNotice later |
| `/notifications/mentions` | Tweet articles when present | UserAuthor + PostFeed |
| `/search?f=user` | Wide UserCells | UserRow |
| `/search` Top/Latest/Media | Tweet articles | UserAuthor + PostFeed |
| `/<handle>` | Hero + articles + Relevant people + **You might like** | UserHero + UserAuthor/PostFeed + UserRail |
| `/<handle>/followers` (and similar) | Hero + UserCells | UserHero + UserRow |
| `/i/connect_people` (incl. `?is_creator_only=true`) | Wide UserCells | UserRow |
| `/i/history`, `/i/bookmarks`, `/i/lists/<id>` | Tweet articles | UserAuthor + PostFeed |
| `/<handle>/status/<id>` | Focused post + replies | UserAuthor + PostFeed |
| `/<handle>/communities/explore` | Tweet articles + sidebar UserCells | UserAuthor+PostFeed + UserRail |
| Hover any page | HoverCard | UserHover |

`classifyPage` in the content scanner labels `/home`, `/explore`, `/notifications`, `/search`, `/i/bookmarks`, `/i/history`, and `/i/lists/<id>` as `timeline`. Article chrome does not depend on that label — any matching tweet article gets UserAuthor+PostFeed.

## How UserCell differs from the timeline

| | Tweet article | UserCell |
|-|---------------|----------|
| Name testid | `User-Name` | none (plain links) |
| Post id | status URL / schema | none |
| Numeric user id | schema / page-world maps | Follow or Subscribe `data-testid="<id>-follow"` / `-subscribe` |
| Action bar | reply/repost/like/bookmark | Follow or Subscribe |
| Width | primary column | Rail is narrow; lists are wide |

## Out of scope

- **DMs** (`/messages`, `/i/chat`): protected content — do not observe or decorate
- **Grok** (`/i/grok`): agent chat, not a user/post feed
- Settings, compose, Premium, Creator Studio, login, TOS
- Trend cells (`[data-testid="trend"]`): topics, not accounts or posts
- Ads: label only; never filter

## Later

- **UserNotice** / **PostNotice** on Notifications All
- **PostQuote** for nested quotes
- GraphQL observe allowlist for History / Notifications (not required for UserCell: follow-button id is enough)
