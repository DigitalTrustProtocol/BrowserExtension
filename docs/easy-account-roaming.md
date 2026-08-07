# Easy account and key roaming

## 1. Purpose

AttentionX needs a Nostr identity (an `nsec`) to sign trust statements and
identity proofs. Technical users can manage keys themselves. Most target users
will not: keys feel irrelevant until they are lost, and the word “Nostr” is a
barrier.

This document describes a **comfort-first Easy path** that hides key management
while keeping the existing Advanced onboarding for power users. It accepts a
deliberate security degradation in Easy mode in exchange for recoverability
across Chromium installs.

**Goals**

- Easy start without seeing or handling an `nsec`.
- Roaming of the sealed key so a new browser / reinstall can restore the same
  identity.
- Prefer solutions that fit inside the extension and do **not** require an
  AttentionX-operated server.
- Keep Advanced onboarding (create / import / bunker / watch-only) unchanged.
- Allow users to graduate to Advanced later (export, stronger password, bunker).

**Non-goals (for this design)**

- Deterministic key derivation from OAuth identity alone (insecure by design).
- Building and hosting an AttentionX key or sync server.
- Making Easy mode as strong as a user-chosen vault password or hardware bunker.

## 2. Product split

Onboarding method chooser (wizard) gains a primary Easy option; existing methods
remain under Advanced.

| Path | User-facing label (intent) | Who it is for |
|------|----------------------------|---------------|
| **Easy** | “Use this browser account” | Default; hide Nostr key details |
| **Advanced** | Existing wizard methods | Create with backup, import `nsec` / seed / `ncryptsec`, NIP-46 bunker, watch-only `npub` |

Easy mode still creates a real Nostr keypair and stores it in the existing
encrypted vault model. The difference is UX and where the sealed blob is
mirrored for roaming — not a second identity system.

Copy should talk about an **AttentionX account** / **browser backup**, not
`nsec`, BIP-39, or bunker URLs, unless the user opens Advanced.

## 3. Assumptions

- AttentionX is Chromium-only for now (Chrome / Edge / Brave and similar).
- Many users are already signed into a Chromium profile with Sync available.
- `chrome.storage.sync` is therefore a practical Phase 1 roaming backend.
- A third-party cloud locker (Google Drive App Data, OneDrive, …) is reserved
  for Phase 2 when Chrome Sync is unavailable or users want an explicit
  “Continue with …” provider login.
- Phase 2 may also strengthen Easy unlock with **passkeys / WebAuthn** (and
  related platform authenticators) instead of only a PIN or never-lock.
- Security tradeoffs in Easy mode are acceptable for current product stakes
  (subjective trust graph, not custody of funds). Advanced remains available
  for maximum control.

## 4. Security model (shared across phases)

### 4.1 Roles

| Role | Responsibility |
|------|----------------|
| **Locker** | Holds **ciphertext only** (Chrome Sync, later Drive / OneDrive, …) |
| **Wrapping secret** | Decrypts the vault / key blob (PIN, password, passkey/PRF, or empty / never-lock) |
| **Extension vault** | Local AES-256-GCM vault in `chrome.storage.local` (existing); keys only in the service worker while unlocked |

Authentication to a locker (Chrome profile, OAuth) proves **who may read the
ciphertext**. It must **not** be the sole secret that wraps the private key.
Never derive `nsec` from OAuth `sub`, email, or similar public identifiers.

Passkeys (Phase 2) are a **wrapping / unlock** mechanism, not a locker: the
sealed blob still lives in Sync or a cloud provider; the authenticator helps
unwrap it without teaching the user an `nsec`.

### 4.2 Easy-mode wrapping options

| Mode | Phase | Comfort | Risk |
|------|-------|---------|------|
| Short PIN | 1 | Good default | Offline brute-force if ciphertext is obtained |
| Never-lock / empty password | 1 | Maximum laziness (aligned with today’s vault option) | Anyone with profile / sync access ≈ has the key |
| Strong vault password | Advanced | Lower comfort | Best classical local wrapping |
| Passkey / WebAuthn (optional PRF) | 2 | High comfort; familiar OS prompt | Depends on platform passkey roaming; MV3/WebAuthn constraints |

Product should be honest: Easy backup is recoverability, not bank-grade custody.
Passkeys improve the unlock story without replacing the need for a locker.

### 4.3 Invariants (unchanged)

- Private keys stay in the background service worker / vault handlers only.
- Content scripts and page-world never receive secrets.
- Advanced export (`nsec` / `ncryptsec` / seed) remains an explicit user action.
- Kind `32009` / NIP-39 signing behavior does not change based on Easy vs Advanced.

## 5. Phase 1 — Use this browser account

**Status:** implemented.

### 5.0 Scenario: signed out / Sync off

`chrome.storage.sync` writes succeed on the profile even when Chrome Sync is
off; they behave like local storage until Sync is enabled. Cross-device restore
requires the user signed into Chromium with Sync on.

**Onboarding UI:** if Chrome reports no signed-in profile (`identity` +
`identity.email`, `getProfileUserInfo` with `accountStatus: 'ANY'`), the
wizard shows a sign-in prompt and a single **Advanced** button (Advanced
methods live on a separate pane). When signed in, Easy is the primary CTA
with the same Advanced button — leaving room for Phase 2 provider buttons.
The method step re-checks sign-in on focus / visibility.

The extension does not fake a Chrome login OAuth flow inside AttentionX.

### 5.0b Scenario: bind an existing local key

Signing into Chrome does not upload `chrome.storage.local`. Users who already
created or imported an `nsec` use **Settings → Security → Back up this account
to this browser** (`onboarding_easyBackupActive`). Same pubkey is preserved.
If sync already holds a different `pubkeyHint`, the UI requires explicit
replace confirmation. Easy create/restore refuse when a local vault already
exists.

### 5.1 User flow

1. Wizard method step offers **Use this browser account** as the primary CTA.
2. Extension checks `chrome.storage.sync` for an AttentionX sealed Easy blob.
3. **Restore path:** sealed blob present → unlock with PIN / never-lock → hydrate
   local vault → set active account → done (skip mnemonic backup / verify).
4. **Create path:** no blob → generate keypair (same as today’s generated
   account) → create local vault with Easy wrapping → mirror sealed blob to
   `chrome.storage.sync` → done.
5. Advanced methods remain reachable from the same method step (or an
   “Advanced” disclosure); their existing wizard steps are unchanged.

Recommended create UX: do **not** force BIP-39 write-down for Easy. Optional
later: “Save a recovery file” / upgrade to password / export `ncryptsec`.

### 5.2 Storage layout

Keep the authoritative working vault in `chrome.storage.local` (existing
`keyVault`).

Roaming mirror in `chrome.storage.sync`:

```text
easyAccountBlob: {
  version: 1,
  updatedAt: <unix ms>,
  ncryptsec: <NIP-49, empty-password wrap>,
  pubkeyHint: <hex>,
  accountName?: string,
  easyRoaming: true
}
```

Constraints:

- Sync quota is ~100 KB total / ~8 KB per item — one Easy blob must stay small
  (single account or minimal vault payload).
- Prefer one sealed item; avoid spreading secrets across many sync keys.
- Conflict policy: **newest `updatedAt` wins**; never merge two different
  private keys into one identity.

Local vault remains the runtime source of truth after unlock. Sync is backup /
restore transport.

### 5.3 Chrome Sync behavior (must document in UI)

- `chrome.storage.sync` **works without** a signed-in Chrome account, but then
  behaves like local storage: **no cross-device roaming**.
- Roaming requires the user signed into Chromium **and** Sync enabled.
- Extensions cannot reliably perform “Log into Chrome” inside the wizard; Sync
  is a browser setting (`chrome://settings/syncSetup`).
- There is no perfect extension API for “Sync is healthy.” Writes succeed
  whether or not data will leave the device. UI copy must not promise sync
  unless softened (“Works best when Chrome Sync is on”).

Wizard framing for Phase 1:

- Prefer: **Use this browser account** / **Back up with this Chrome profile**.
- Avoid: fake in-extension “Login with Chrome” OAuth that implies AttentionX
  controls Chrome account login.

### 5.4 Wizard / code touchpoints (implementation notes)

Likely areas when implementing (not exhaustive):

- `src/shared/wizardMachine.ts` — new Easy method / steps (create vs restore).
- Onboarding UI (popup / onboarding app method chooser).
- `src/vault/**` — seal/unseal helper; optional sync mirror on vault create /
  re-encrypt / destroy.
- `src/accounts/bg/onboarding-handlers.ts` — Easy create/restore RPCs.
- Locales — Easy copy without Nostr jargon; Advanced keeps current strings.

Account type can remain `generated` (or a dedicated Easy marker in metadata) so
signing paths stay unchanged.

### 5.5 Phase 1 success criteria

- New user can finish onboarding without seeing an `nsec` or mnemonic.
- Reinstall on another Chromium profile with the same Sync account restores the
  same pubkey after Easy unlock.
- Advanced wizard paths behave as today.
- User can later export or set a stronger password without changing pubkey.

## 6. Phase 2 — Third-party lockers, passkeys, and related unlock

**Status:** deferred; design only.

Phase 2 has two related tracks that can ship independently:

1. **More lockers** — where the sealed blob lives (beyond Chrome Sync).
2. **Better wrapping** — how the user unlocks that blob (passkeys / WebAuthn,
   platform authenticators), still without exposing `nsec`.

### 6.1 Why

Phase 1 does not help when:

- The user is not signed into Chrome / Sync is off.
- The user wants an explicit “Continue with Google / Microsoft” mental model.
- Future non-Chromium or multi-browser restores are required.
- A short PIN / never-lock is too weak or too awkward, and a passkey would be
  a better Easy unlock.

### 6.2 Locker provider strategy

Implement **one** cloud locker first; add more only if needed.

| Priority | Provider | Notes |
|----------|----------|-------|
| 1 | Google Drive **Application Data** folder | Natural with `chrome.identity`; private app data; no AttentionX server |
| 2 | Microsoft OneDrive app folder | Same pattern for work/school accounts |
| — | GitHub | Poor fit as a key locker; skip unless a strong reason appears |
| — | Self-hosted AttentionX sync | Out of scope; fights “no server” preference |

Optional later: NIP-46 bunker as “login” where the extension never holds `nsec`
(`AccountType: 'nip46'` already exists). That is a **remote signer**, not a
blob locker — separate product choice.

### 6.3 Passkeys / WebAuthn (wrapping track)

**Intent:** “Unlock with this device / passkey” as an Easy alternative to PIN
or never-lock, including when the blob still lives in Chrome Sync (Phase 1
locker) or a Phase 2 cloud locker.

**Shape (design intent):**

- Register a passkey during Easy create or as an upgrade from PIN.
- On restore / unlock, WebAuthn ceremony unwraps the vault key (prefer
  **PRF / hmac-secret** where available so the authenticator contributes key
  material; fall back to gated unlock flows if PRF is unavailable).
- Roaming follows the user’s passkey provider (e.g. Google Password Manager,
  iCloud Keychain, Windows Hello / platform authenticator) — complementary to
  blob roaming via Sync or Drive.
- Run WebAuthn from an **extension page** (popup / onboarding / dedicated
  unlock UI), not from the service worker.
- Keep PIN or export as recovery if the passkey is lost; do not make passkey
  the only path without a documented escape hatch.

**Related options in the same track (evaluate at implement time):**

| Mechanism | Role |
|-----------|------|
| Passkey (discoverable credential) | Primary Easy unlock UX |
| WebAuthn PRF / hmac-secret | Prefer for deriving/unwrapping the vault key |
| Platform authenticator only (no cloud passkey) | Device-bound unlock; weaker roaming |
| Credential Manager / password-manager APIs | Only if they clearly improve Easy UX without a server |

Passkeys do **not** replace lockers: without Sync or a cloud blob, a passkey
alone cannot recreate an `nsec` that was never stored.

### 6.4 Provider interface (sketch)

Abstract a small backend so Sync and cloud lockers share restore/create logic:

```text
EasyLocker {
  id: 'chrome-sync' | 'google-drive' | 'onedrive' | ...
  isAvailable(): Promise<boolean>
  getBlob(): Promise<EasyAccountBlob | null>
  putBlob(blob: EasyAccountBlob): Promise<void>
  clearBlob(): Promise<void>
}
```

Wrapping remains separate from the locker:

```text
EasyUnwrap {
  id: 'pin' | 'never-lock' | 'passkey' | 'password' | ...
  unlock(blob): Promise<VaultPayload>  // or vault crypto key
}
```

Wizard Phase 2 additions:

- “Continue with Google” (etc.) → OAuth → `getBlob` / `putBlob`.
- “Unlock with passkey” on create/restore when WebAuthn is available.
- Prefer restoring an existing blob over creating a second key for the same
  person without confirmation.

### 6.5 Phase 2 success criteria

- User can restore the same Easy identity on a Chromium install **without**
  Chrome Sync, using one third-party locker.
- Ciphertext-only at the provider; no plaintext `nsec` upload.
- Adding a second locker reuses the blob format and unlock UX.
- User can unlock Easy mode with a passkey (where supported) without seeing an
  `nsec`, with a documented recovery path if the passkey is unavailable.

## 7. Relationship to existing vault

Today (see `docs/design.md` § 3.1 and `src/vault/vault.ts`):

- Keys live in an AES-256-GCM vault (PBKDF2) in `chrome.storage.local`.
- Account types include generated, imported `nsec`, watch-only, NIP-46, external.
- Never-lock with empty password already exists as an explicit comfort tradeoff.

This design **extends** that model with:

1. An Easy onboarding entry that auto-creates a key and skips mnemonic theatre.
2. A roaming mirror of sealed material (Phase 1: Sync; Phase 2: cloud locker).
3. Optional Phase 2 passkey / WebAuthn unwrap for Easy unlock.
4. Clear product language that hides Nostr until Advanced is chosen.

It does not replace NIP-07, bunker support, or Advanced import/export.

## 8. Risks and open questions

| Topic | Note |
|-------|------|
| Sync quota / item size | Keep Easy blob minimal; test Edge/Brave Sync quirks |
| Sync conflicts | Newest wins; document dual-device race behavior |
| Detecting Sync health | Soft copy only; optional weak signals later |
| PIN strength | Rate-limit unlock locally; warn on very short PINs |
| Blob format | Reuse vault envelope vs single `ncryptsec` — decide at implement time |
| Multi-account Easy | Per-X Easy blobs (`easyAccountBlobs` v2), max **10** X-bound backups; 1↔1 with vault `boundTwitterId`. Sync merge uses latest `updatedAt` (never deletes local vault keys). NIP-07 multi-account UI remains for non-X sites. |
| Migration | Advanced → Easy backup, and Easy → stronger password / passkey, should preserve pubkey |
| Manifest | Phase 2 may need OAuth / identity permissions and privacy-policy updates |
| WebAuthn in MV3 | Ceremony from extension pages only; PRF support varies by OS / authenticator |
| Passkey loss | Require recovery (PIN, export, or re-link locker + new wrap) before making passkey default |
| Passkey vs locker roaming | Blob and passkey may roam on different accounts; UX must not assume they always match |

## 9. Implementation phases summary

| Phase | Deliverable |
|-------|-------------|
| **Phase 1** | Implemented: wizard Easy path; auto-create / restore; Settings backup bind; `chrome.storage.sync` `easyAccountBlob`; Advanced unchanged |
| **Phase 1.5** | Per-X `easyAccountBlobs` map + `xNostrBindings` Sync index; vault `boundTwitterId` operator binding (see architecture) |
| **Phase 2** | Pluggable third-party locker(s); same sealed blob; OAuth “Continue with …”; passkey / WebAuthn (and related) Easy unlock — still without teaching users `nsec` |

No AttentionX-operated server is required for either phase.
