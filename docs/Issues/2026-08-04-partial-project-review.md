# AttentionX project review — 2026-08-04

Status: partial review, stopped at the user’s request. No fixes were applied as part of
the review. The findings below are based only on files inspected before the review
was stopped.

Severity:

- **High** — security, privacy, or user-visible trust correctness issue.
- **Medium** — correctness, reliability, or data-integrity issue.
- **Low** — hardening, maintainability, or edge-case issue.
- **Potential** — the risk was identified, but the full runtime exploit path was not
  proven.

The full project check (`npm run check`) was not run during this review.

## High-priority findings

### AX-001 — X response rewriting contradicts the architecture

**Severity:** High → **Accepted exception** (rules updated 2026-08-04)

**Files:** `src/page-world/json-trust-filter.ts`

The JSON trust filter modifies allowlisted X timeline GraphQL `Response`
payloads (hide-only, with optional backfill) so filtered items never enter X's
renderer. That conflicts with the older “never modify responses” wording, but
the rewrite is intentional: DOM-only hiding still mounts and paints removed
items; JSON rewrite is required to optimize timeline rendering.

**Resolution:** Architecture rules, `AGENTS.md`, `docs/architecture.md`,
`docs/design.md`, and `PRIVACY.md` now allow this specific exception. Keep the
rewrite scoped to allowlisted timeline operations, prefer fail-open on
parse/rewrite failure, and do not invent posts or modify X requests / account
actions. Do not remove the rewrite path as a remediation.

**Previous recommendation (superseded):** Remove response rewriting and backfill
mutation. Keep trust augmentation in the isolated Shadow-DOM UI only.

### AX-002 — NIP-07 page responses can be spoofed

**Severity:** High → **Fixed** (MessageChannel handshake, 2026-08-04)

**Files:** `src/nip07/inject.ts`, `src/nip07/content-bridge.ts`,
`src/nip07/page-bridge-protocol.ts`

The page-world response handler previously accepted public `window.postMessage`
`NIP07_RESPONSE` values after only an `event.source` check. A same-page script
could observe outgoing request IDs and race a fake response.

**Resolution:** Inject and bridge perform a `document_start` handshake that
transfers a `MessagePort`. All NIP-07 RPC and account-change notifications then
travel only on that port (`page-bridge-protocol.ts`). Inject claims the offer
with `stopImmediatePropagation`, checks `event.origin`, and correlates one
response per pending id. Residual MAIN-world limits remain (hostile scripts can
still replace `window.nostr` or race an earlier handshake listener); the
background service worker stays the authoritative key/signing boundary.

### AX-003 — NIP-07 signing input is insufficiently bounded

**Severity:** High → **Fixed** (kind-aware bounds, 2026-08-05)

**Files:** `src/nip07/sign-event-bounds.ts`, `src/nip07/bg/nip07-handlers.ts`,
`src/nip07/signer.ts`

`validateNip07Params()` previously checked tag shape but did not bound tag
count, tag element length, content bytes, or total serialized event size, and
allowed omitted `tags` / `created_at`.

**Resolution:** `assertBoundedUnsignedEvent()` requires canonical fields and
enforces per-kind caps before queueing/signing. Kind `32009` uses the product
UI content cap (144 Unicode characters); notes and other kinds allow longer
content within finite safety limits. nip04/nip44 payloads are similarly capped.
`handleSignEvent` re-checks bounds as defense in depth.

### AX-004 — The NIP-07 activity log stores arbitrary event payloads

**Severity:** High privacy / Medium reliability → **Fixed** (2026-08-05)

**Files:** `src/nip07/bg/activity-handlers.ts`, `src/shared/activity.ts`

Approved and rejected `signEvent` requests previously persisted the complete
event, including content and tags. `ACTIVITY_LOG_GLOBAL_MAX` was defined but
never enforced.

**Resolution:** One generic `activityLog` (no extra tables). Each row stores
`timestamp`, `domain`, `method`, `decision`, optional `kind` / `pubkey`,
`eventId` when signed, and `reason` when unsuccessful. Content/tags are never
persisted; legacy rows migrate on read. Writes use `AsyncLock` with per-domain
and global caps. Approval UI still shows full events in memory while prompting.

### AX-005 — Page-originated proof/account messages are not fully trustworthy

**Severity:** High → **Fixed** (MessageChannel + oEmbed revalidation, 2026-08-05)

**Files:** `src/shared/page-world-bridge-protocol.ts`,
`src/content/page-world-port.ts`, `src/page-world/page-world-port.ts`,
`src/content/identity-bridge.ts`, `src/content/proof-search-bridge.ts`,
`src/content/proof-capture-bridge.ts`, `src/content/json-filter-bridge.ts`,
`src/page-world/identity-observer.ts`, `src/page-world/json-trust-filter.ts`,
`src/background/backend.ts`, `src/content/active-account.ts`

`SEARCH_PROOF_POST` and `REPORT_ACTIVE_X_ACCOUNT` ultimately depend on values that
can originate in page messages. A malicious page can attempt to supply arbitrary
handles, numeric IDs, post IDs, or proof text. Several bridges validate
`event.source` but do not validate origin, trust state, message size, or a session
nonce.

**Resolution:** Content and page-world perform a handshake that transfers a
`MessagePort` (`page-world-bridge-protocol.ts`); identity observations, proof
search/capture, and JSON trust-filter traffic travel only on that port. Host
parsers require numeric post IDs, normalized handles, and bounded text. Active
account IDs come from `twid` / DOM only — never the observation map. Background
revalidates page-reported proof posts via public oEmbed (`#revalidatePageProofPost`)
before `#recordXProofSide` or capture publish.

### AX-006 — Graph scope data is lost and non-X scopes can enter the X graph

**Severity:** High correctness → **Fixed** (scope policy without Graph change,
2026-08-05)

**Files:** `src/graph/types.ts`, `src/background/backend.ts`,
`src/graph/adapter.ts`, `src/shared/kind-32009.ts`, `src/relay/filters.ts`

`ReducedTrustStatement` omits `scopes`. `reducedStatement()` drops parsed `s` tags,
and `slotAddressableId()` uses only author, subject, and context. Two valid events
with the same author/subject/context but different scopes can therefore collapse
into one in-memory graph slot even though their protocol `d` values differ.

Additionally, `#loadGraphSourceEvents()` loads all kind `32009` events from eligible
authors without filtering to the X scope. A non-X statement can influence an X
trust query.

**Product decision:** AttentionX does **not** need scope in the Graph. Scope is
handled at publish, relay filter, and ingest eligibility. On x.com: empty scope
(global / all sites) and `s=x.com` both apply; `x.com` precedes empty when both
exist; new publish defaults use `s=x.com` for both **user** and **post**
subjects, while older empty-scope user trusts remain valid. Relay sync omits
`#s` so both scope forms match; client-side eligibility drops unrelated
scopes. Documented in
[architecture.md § Scope policy](../architecture.md#scope-policy-attentionx-on-xcom).

**Resolution (2026-08-05):** Publish defaults, relay filters, sync reject path,
and `#loadGraphSourceEvents` selection align with that policy. Graph slots
unchanged.

### AX-007 — NIP-39 proof binding needs independent identity checks

**Severity:** High potential

**Files:** `src/identity/proof.ts`, `src/background/backend.ts`

The review raised a concern that handle-only oEmbed/proof-post results may not
independently establish the declared numeric X ID. Proof-search handles and IDs can
also originate from untrusted page observations. A wrong handle can lead to an
incorrect provisional X-proof row even when final verification later remains
unverified.

**Recommendation:** Require all of the following before verification: matching
proof text and Nostr key, proof-post author matching the declared handle, and
independent public-profile resolution to the exact numeric ID. Keep provisional
observations visibly unverified and never use them for graph aliases.

**Resolution (2026-08-05):** Either side may arrive first. On every row update,
status sync re-evaluates; when columns align and the row is not yet verified,
it runs existing `verifyNip39Proof` (oEmbed + profile→ID) — not a new search-path
fetch. Success → `verified` → graph. Aligned columns alone stay provisional.
Already-verified rows stay verified without re-fetching.

### AX-008 — Invalid auto-lock values can disable locking

**Severity:** High potential

**Files:** `src/vault/bg/vault-handlers.ts`, `src/vault/vault.ts`

`vault_setAutoLock` does not validate that `ms` is finite, non-negative, and
bounded. Negative or invalid values can clear the active timer without being the
explicit, documented zero-millisecond “never lock” mode.

**Recommendation:** Accept only `0` or a bounded positive safe integer and reject
all other values before changing the vault state.

**Resolution (2026-08-05):** `assertValidAutoLockMs` rejects anything other than
`0` or a positive safe integer ≤ 24h before handler password transitions,
`setAutoLockTimeout`, and onboarding persistence. Corrupt stored values fall
back to the default interval on restore instead of disabling the timer.

### AX-009 — Outbox publishing has concurrent flush/delete races

**Severity:** High potential

**Files:** `src/relay/outbox.ts`, `src/storage/repository.ts`,
`src/background/backend.ts`, `src/background/adapters.ts`

Concurrent flushes can read the same due entry and publish it to the same relay
more than once. Deletion can race with a later flush write and resurrect status.
`RepositoryOutboxAdapter.put()` merges relay state and skips equal-attempt updates,
which can preserve stale state.

**Resolution (2026-08-05):** Outbox flush uses per-relay claim/complete CAS on
the existing `outbox` store (`claimedAt` + attempt generation), serializes
`flush`/`retryDue` in the publisher, and never recreates a deleted row on
complete. Stale claims expire after `OUTBOX_CLAIM_TTL_MS` so a dead service
worker cannot permanently block retries. No new IndexedDB store or version bump.

## Medium-priority findings

### AX-010 — RPC envelopes can fail before returning an error

**Severity:** Medium

**Files:** `src/background/rpc-router.ts`

The NIP-07 listeners write to `request.params` without first ensuring it is an
object. Missing params can cause a `TypeError`. Malformed `originUrl` values can
also make `new URL()` throw outside the response path.

**Recommendation:** Normalize missing params to `{}`, validate the envelope before
mutation, wrap URL parsing, and always send a structured error response.

### AX-011 — NIP-07 permissions use hostname instead of full origin

**Severity:** Medium / design

**Files:** `src/shared/url.ts`, `src/nip07/bg/domain-handlers.ts`,
`src/background/rpc-router.ts`

Permission checks use only `URL.hostname`. Approving one host covers HTTP/HTTPS
and every port on that host.

**Recommendation:** Either document hostname-wide access as intentional and show it
clearly in the UI, or use scheme plus host and optionally port as the permission
key.

### AX-012 — Direct NIP-07 message requests are classified as privileged

**Severity:** Medium

**Files:** `src/background/rpc-router.ts`, `src/nip07/bg/state.ts`

`PRIVILEGED_METHODS` is built from every handler map, including `nip07_*` handlers.
The direct `runtime.onMessage` path can therefore reject page-facing NIP-07
requests from content scripts. The current provider uses a named port path, so
this is not necessarily a total provider failure.

**Recommendation:** Explicitly exclude page-facing NIP-07 methods from privileged
methods and keep privileged checks for internal extension handlers only.

### AX-013 — Repository writes do not enforce validation themselves

**Severity:** Medium defense-in-depth

**Files:** `src/storage/repository.ts`, `src/background/adapters.ts`,
`src/background/backend.ts`

`AttentionXRepository.ingestEvent()` computes storage keys and writes events without
validating signatures or supported event schemas. Current production adapters
usually validate first, but future callers or import paths could bypass that
boundary.

**Recommendation:** Validate supported events inside the repository before any
IndexedDB write, while retaining adapter validation for useful sync statistics.

### AX-014 — Replaced events can leave orphan relay observations

**Severity:** Medium

**Files:** `src/storage/repository.ts`, `src/storage/schema.ts`

Some replacement/import paths delete the old event and outbox row but do not delete
all `relayObservations` for the superseded event. The v6 migration also does not
clean existing orphan observations.

**Recommendation:** Centralize event replacement and deletion cleanup in one
readwrite transaction that removes related observations and outbox data.

### AX-015 — Storage replacement migration risks need verification

**Severity:** Medium potential

**Files:** `src/storage/schema.ts`

The v6 unique `addressKey` migration and demo-state namespace changes can expose
legacy duplicate or incorrectly namespaced rows. An interrupted migration must
also be restartable without leaving orphaned data.

**Recommendation:** Add migration fixtures for duplicate address keys, demo/live
collisions, interrupted upgrades, and orphan observations. Do not add stores or
bump the database version without explicit approval.

### AX-016 — Outbox metrics report attempted relays inaccurately

**Severity:** Medium

**Files:** `src/background/backend.ts`

`attemptedRelays` can include configured or held relays rather than only relays
actually attempted during the current publish operation.

**Recommendation:** Return the publisher’s per-run attempted count and distinguish
held, skipped, failed, and delivered relays.

### AX-017 — Graph path reconstruction loses intermediate hops

**Severity:** Medium

**Files:** `src/graph/query.ts`, `src/graph/trust/pathStrategyJson.ts`

For multi-hop trust, path results can contain only the root and terminal evidence
author. Traversal event IDs can be omitted or flattened into one combined path.

**Recommendation:** Reconstruct one ordered predecessor chain per terminal evidence
statement and include every traversal event ID.

### AX-018 — Graph internal IDs discard subject type

**Severity:** Low–Medium

**Files:** `src/graph/adapter.ts`, `src/graph/query.ts`

`graphSubjectId()` is only the lowercased subject value. A `p` and `e` subject with
the same 64-hex value can collide in the heap graph, even though wire IDs retain
the subject type.

**Recommendation:** Use typed heap IDs or enforce a validation invariant that makes
such values impossible.

### AX-019 — Low-level graph replacement APIs leave stale structures

**Severity:** Low–Medium

**Files:** `src/graph/trust/Graph.ts`, `src/graph/graph.ts`

`Graph.addEdge()` updates an existing edge without relocating adjacency if a caller
reuses an addressable ID with a changed subject or context. `removeEdge()` leaves
stale adjacency map entries. `applyTrustEvent()` mutates the graph before returning
false for an empty subject list.

The normal AttentionX adapter usually prevents these inputs, so this is primarily
a low-level API robustness issue.

**Recommendation:** Validate event shape before mutation and remove/replace old
adjacency entries transactionally.

### AX-020 — X numeric IDs are not canonicalized consistently

**Severity:** Medium

**Files:** `src/shared/x-identity.ts`, `src/shared/observed-x-identity.ts`,
`src/relay/filters.ts`, `src/shared/kind-32009.ts`

Several validators and relay filters accept leading-zero decimal IDs. This can
create duplicate identity rows and distinct-looking but semantically equivalent
subjects. Very large decimal identifiers are also not consistently bounded.

**Recommendation:** Use one canonical validator such as `0|[1-9]\d*`, normalize
all storage/filter inputs, and define a maximum identifier length.

### AX-021 — Active X account inputs lack complete runtime validation

**Severity:** Medium

**Files:** `src/background/backend.ts`

`REPORT_ACTIVE_X_ACCOUNT` does not validate the runtime shape of `request.account`.
`detectedAt` needs finite, positive-integer validation. The outer
`GET_X_IDENTITY_DISPLAYS` array is bounded, but individual IDs are silently
filtered instead of rejected and canonicalized.

**Recommendation:** Validate exact request schemas, timestamps, numeric IDs, and
sender tab identity at the background boundary.

### AX-022 — Page-world XHR overrides are not best-effort

**Severity:** Medium

**Files:** `src/page-world/identity-observer.ts`

`Object.defineProperty()` calls for XHR `responseText` and `response` are not
protected by `try/catch`. Browser descriptor behavior can vary and an override
failure should never break X.

The byte-budget traversal should also return immediately after exceeding its
maximum.

**Recommendation:** Wrap overrides independently, restore safely, and fail closed
when an XHR cannot be inspected.

### AX-023 — Safari session-storage fallback has weaker lifecycle semantics

**Severity:** Medium privacy

**Files:** `src/vault/browser.ts`

The fallback stores `storage.session` data in `storage.local`, which can survive
browser restarts. Its `onChanged` event is the unfiltered local-storage event.
Wizard mnemonic data and pending signer state therefore do not have true session
semantics on that platform.

**Recommendation:** Use native session storage where available and explicitly
clear fallback namespaced data at startup and expiry.

### AX-024 — Unlock failure counter is not atomic

**Severity:** Medium potential

**Files:** `src/vault/bg/vault-handlers.ts`

Concurrent unlock requests can read and overwrite the same failure counter, allowing
more attempts than intended and losing lockout progress.

**Recommendation:** Serialize guard reads/writes with the existing async lock or
use an atomic state transition.

### AX-025 — NIP-04 input parsing is permissive

**Severity:** Low–Medium

**Files:** `src/vault/crypto/nip04.ts`

NIP-04 parsing does not clearly enforce exactly one `?iv=` separator, a 16-byte IV,
or valid ciphertext block length.

**Recommendation:** Enforce exact format and bounds before decryption.

### AX-026 — NIP-44 temporary buffers are not all explicitly cleared

**Severity:** Low

**Files:** `src/vault/crypto/nip44.ts`

Key material is cleared in several `finally` blocks, but buffers such as
`hmacInput` and `expectedMac` remain subject to garbage collection.

**Recommendation:** Explicitly clear mutable temporary buffers where practical and
document the unavoidable limits of JavaScript memory cleanup.

### AX-027 — Direct storage/import paths may retain malformed kind `10011`

**Severity:** Medium potential

**Files:** `src/storage/repository.ts`, `src/shared/kind-10011.ts`

Main backend paths validate kind `10011`, but direct repository/import paths do not
necessarily enforce the full supported-event validator.

**Recommendation:** Enforce supported-kind validation in the storage boundary and
add malformed replacement tests.

## Lower-priority findings and unresolved questions

### AX-028 — Vault serialization creates non-zeroable secret strings

**Severity:** Low–Medium hardening

**Files:** `src/vault/vault.ts`, `src/vault/bg/vault-handlers.ts`

`toStoragePayload()`, `JSON.stringify()`, `create()`, `save()`, `unlock()`, and
`reEncrypt()` create hex private-key and mnemonic strings. JavaScript strings
cannot be reliably zeroed. `getDecryptedPayload()` exposes a full secret-bearing
copy to internal handlers.

The implementation does correctly zero many byte arrays and callers generally
zero copies returned by `getPrivkey()`.

**Recommendation:** Minimize secret-bearing copies, avoid unnecessary JSON
round-trips, and expose narrowly scoped vault operations instead of full payloads.

### AX-029 — “Never lock” mode is not password protection

**Severity:** Low / documented design risk

**Files:** `src/vault/vault.ts`, `docs/architecture.md`

An empty password can be derived by code with access to the extension storage and
source. The code documents this as defense-in-depth, not a strong secret.

The architecture documentation still contains older wording that describes the
signing key as raw browser storage, which is stale relative to the encrypted vault.

**Recommendation:** Keep the warning prominent, prefer timed locking by default,
and update the architecture documentation.

### AX-030 — Legacy/dead UI and localization paths

**Severity:** Low

**Files:** `src/App.tsx`, `src/i18n/resources.ts`, `src/i18n/react.ts`

`App.tsx` appears unused because the current entry point renders `PopupApp`.
Legacy localization includes stale wording suggesting the Nostr secret is
unencrypted.

**Recommendation:** Remove dead paths or mark them clearly as legacy and update
security-sensitive translations.

### AX-031 — Blossom authentication path is unresolved

**Severity:** Open question

The review identified a `signEvent:24242` Blossom-auth path but did not finish
determining whether it is active or stale.

**Recommendation:** Locate all `24242` call sites before changing signing
permissions or validation.

## Test coverage gaps identified

Add focused tests for:

- NIP-07 oversized content/tags, missing fields, malformed envelopes, and bridge
  response spoofing.
- Activity-log global limits, payload redaction, and concurrent writes.
- NIP-39 invalid cryptographic proofs, invalid `npub` values, and mismatched
  profile IDs.
- Leading-zero and oversized X IDs.
- Relay sync covering `#s=x.com` and empty-scope events; ingest eligibility for
  X (exclude unrelated scopes).
- Multi-hop ordered graph paths and source event provenance.
- Graph subject-type collisions and replacement adjacency cleanup.
- Concurrent outbox flush, delete, retry, and stale-write behavior.
- IndexedDB migration duplicates, demo/live address collisions, interrupted
  upgrades, and orphan observations.
- Invalid auto-lock values and concurrent unlock attempts.

## Findings that were checked and not confirmed as defects

- `QUERY_TRUST_BATCH` has a top-level `MAX_TRUST_BATCH_ITEMS` check.
- `signer.cleanupStale()` is called during vault runtime startup.
- Main production kind `32009` and kind `10011` ingest paths validate before
  calling storage, although repository-level validation is still recommended.
- The graph `distance` calculation of `degree - 1` appears correct for terminal
  evidence at the hitting degree; the path reconstruction, not that arithmetic,
  is the confirmed concern.
- No `runtime.onMessageExternal` or `runtime.onConnectExternal` listener was
  found; the external-extension messaging concern remains a hardening/documentation
  question rather than a confirmed endpoint.

## Recommended remediation order

1. Close page/content message trust gaps and strengthen proof binding.
   (AX-001 accepted exception; AX-002 MessageChannel fixed; AX-003 kind-aware
   bounds fixed; AX-004 activity-log redaction fixed.)
2. Scope policy aligned (empty user / `x.com` post; open `#s` relay pulls +
   client eligibility). Graph slots unchanged. (AX-006)
3. Fix outbox claiming and replacement cleanup.
4. Validate auto-lock values, unlock concurrency, and canonical X IDs.
5. Add migration, graph, bridge, identity, and concurrency tests.
6. Run `npm run check` and perform a separate UI/runtime verification pass.
