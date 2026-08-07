/**
 * Deterministic Nostr identity from email + password + PIN.
 *
 * PBKDF2-SHA256 → 16-byte BIP-39 entropy → 12-word mnemonic → NIP-06 account.
 * Checksum = SHA-256(SHA-256(entropy)) for login verification (no secrets synced).
 *
 * @module vault/crypto/credential-seed
 */

import { PBKDF2_ITERATIONS } from '../constants.ts'
import { createFromMnemonic } from '../../accounts/accounts.ts'
import type { Account } from '../types.ts'
import { entropyToMnemonic } from './bip39.ts'
import { bytesToHex, sha256 } from './utils.ts'

export const CREDENTIAL_PBKDF2_ITERATIONS = PBKDF2_ITERATIONS
export const CREDENTIAL_SALT_PREFIX = 'attentionx-credential-v1:'
export const CREDENTIAL_ENTROPY_BYTES = 16
export const MAX_CREDENTIAL_CHECKSUMS = 20

const SPECIAL_CHAR_RE = /[^A-Za-z0-9]/
const DIGIT_RE = /\d/
const PIN_RE = /^\d{4,8}$/

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase().replace(/\s+/g, '')
}

export function validateCredentialPassword(password: string): {
  ok: true
} | { ok: false; reason: string } {
  if (password.length < 12) {
    return { ok: false, reason: 'password_too_short' }
  }
  if (!DIGIT_RE.test(password)) {
    return { ok: false, reason: 'password_needs_digit' }
  }
  if (!SPECIAL_CHAR_RE.test(password)) {
    return { ok: false, reason: 'password_needs_special' }
  }
  return { ok: true }
}

export function validateCredentialPin(pin: string): {
  ok: true
} | { ok: false; reason: string } {
  if (!PIN_RE.test(pin)) {
    return { ok: false, reason: 'pin_invalid' }
  }
  return { ok: true }
}

export function validateCredentialInputs(input: {
  email: string
  password: string
  pin: string
}):
  | { ok: true; email: string; password: string; pin: string }
  | { ok: false; reason: string } {
  const email = sanitizeEmail(input.email)
  if (!email || !email.includes('@')) {
    return { ok: false, reason: 'email_invalid' }
  }
  const pw = validateCredentialPassword(input.password)
  if (!pw.ok) return pw
  const pin = validateCredentialPin(input.pin)
  if (!pin.ok) return pin
  return { ok: true, email, password: input.password, pin: input.pin }
}

async function sha256Utf8(text: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(text))
}

/**
 * Derive 16-byte BIP-39 entropy via PBKDF2-SHA256.
 * Password input is always password + ":" + pin (both required).
 */
export async function deriveCredentialEntropy(
  email: string,
  password: string,
  pin: string,
  iterations: number = CREDENTIAL_PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  const salt = await sha256Utf8(CREDENTIAL_SALT_PREFIX + email)
  const pwd = new TextEncoder().encode(`${password}:${pin}`)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    pwd,
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  pwd.fill(0)
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    CREDENTIAL_ENTROPY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

export function checksumFromEntropy(entropy: Uint8Array): string {
  return bytesToHex(sha256(sha256(entropy)))
}

export async function deriveCredentialAccount(input: {
  email: string
  password: string
  pin: string
  iterations?: number
  name?: string
}): Promise<{
  account: Account
  mnemonic: string
  checksum: string
  iterations: number
  entropy: Uint8Array
}> {
  const validated = validateCredentialInputs(input)
  if (!validated.ok) {
    throw new Error(validated.reason)
  }
  const iterations = input.iterations ?? CREDENTIAL_PBKDF2_ITERATIONS
  const entropy = await deriveCredentialEntropy(
    validated.email,
    validated.password,
    validated.pin,
    iterations,
  )
  let mnemonic: string
  try {
    mnemonic = await entropyToMnemonic(entropy)
  } catch (err) {
    entropy.fill(0)
    throw err
  }
  const checksum = checksumFromEntropy(entropy)
  const localPart = validated.email.split('@')[0] || 'Email'
  const name = input.name?.trim() || localPart || 'Email account'
  const account = await createFromMnemonic(mnemonic, name)
  return { account, mnemonic, checksum, iterations, entropy }
}
