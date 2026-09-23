# Credential login (email / password / PIN)

Attention can derive a Nostr identity from email + password + PIN. This is a
**comfort path**, not the strongest security model. Prefer a random BIP-39
phrase (Advanced) when possible.

## Derivation

1. Sanitize email: trim, lowercase.
2. Password ≥ 12 characters with at least one digit and one special character.
3. PIN: 4–8 digits.
4. `salt = SHA-256("attentionx-credential-v1:" + email)`
5. PBKDF2 password material: `password + ":" + pin` (both always required).
6. `entropy = PBKDF2-SHA256(…, iterations=210000, dkLen=16)`
7. BIP-39 12-word mnemonic from entropy → NIP-06 account (`type: generated`).
8. Login checksum: `SHA-256(SHA-256(entropy))`, stored as
   `{ checksum, iterations }` (never email/password/PIN).

## X binding (One X = One Nostr)

After create/login, if a signed-in X `twitterId` is known, the account is bound
via `boundTwitterId` (see [architecture.md](architecture.md) § Operator binding).
Unbound accounts work for NIP-07 off X but do **not** roam until bound.

## Roaming of Nostr keys

Security toggle **“Roaming of Nostr keys”** (default ON) consents to Sync of:

- X-bound sealed Easy blobs (`easyAccountBlobs`, max 10, ≤ 5 KB/entry)
- `xNostrBindings` index
- credential checksums

Requires Chrome profile sign-in to push. OFF clears Sync copies; local accounts
stay. Logout clears local vault **and** Sync roaming.

Delete of an X-bound account writes a Sync delete marker (`deleted` + `npubDeleted`,
no secrets). Other devices silently remove that local account on merge.

## Export

Credential accounts store a mnemonic, so Settings → Export seed / nsec /
ncryptsec work after login.
