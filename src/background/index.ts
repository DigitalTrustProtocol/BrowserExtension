import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  SimplePool,
  type Event,
} from 'nostr-tools'
import { mergeEvents, summarizeAssessments } from '../shared/assessment'
import {
  ATTENTIONX_EVENT_KIND,
  ATTENTIONX_LABEL_NAMESPACE,
  DEFAULT_RELAYS,
  NIP39_EVENT_KIND,
  STORAGE_KEY,
  type AssessmentTarget,
  type AssessmentVerdict,
  type ContextSummary,
  type ExtensionRequest,
  type ExtensionResponse,
  type PublicExtensionState,
  type PublishResult,
} from '../shared/contracts'
import { buildNip39TwitterLinkTags } from '../shared/x-identity'

interface StoredState {
  secretKeyHex?: string
  relays: string[]
  cachedEvents: Event[]
}

const pool = new SimplePool({
  enableReconnect: false,
})

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error('Invalid Nostr secret key')
  }

  return Uint8Array.from(hex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)))
}

function normalizeRelays(relays: string[]): string[] {
  const normalized = new Set<string>()

  for (const relay of relays) {
    const url = new URL(relay.trim())
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      throw new Error(`Relay must use ws:// or wss://: ${relay}`)
    }
    normalized.add(url.toString().replace(/\/$/, ''))
  }

  if (normalized.size === 0) {
    throw new Error('Configure at least one relay')
  }

  return [...normalized]
}

async function readState(): Promise<StoredState> {
  const result = await chrome.storage.local.get(STORAGE_KEY)
  const stored = result[STORAGE_KEY] as Partial<StoredState> | undefined

  return {
    secretKeyHex: stored?.secretKeyHex,
    relays: stored?.relays?.length ? stored.relays : [...DEFAULT_RELAYS],
    cachedEvents: stored?.cachedEvents ?? [],
  }
}

async function writeState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state })
}

function toPublicState(state: StoredState): PublicExtensionState {
  const secretKey = state.secretKeyHex
    ? hexToBytes(state.secretKeyHex)
    : undefined
  const pubkey = secretKey ? getPublicKey(secretKey) : undefined

  return {
    hasIdentity: Boolean(secretKey),
    npub: pubkey ? nip19.npubEncode(pubkey) : undefined,
    pubkey,
    relays: state.relays,
    cachedEventCount: state.cachedEvents.length,
  }
}

async function generateIdentity(): Promise<PublicExtensionState> {
  const state = await readState()
  state.secretKeyHex = bytesToHex(generateSecretKey())
  await writeState(state)
  return toPublicState(state)
}

async function importIdentity(nsec: string): Promise<PublicExtensionState> {
  const decoded = nip19.decode(nsec.trim())
  if (decoded.type !== 'nsec') {
    throw new Error('Enter a valid nsec key')
  }

  const state = await readState()
  state.secretKeyHex = bytesToHex(decoded.data)
  await writeState(state)
  return toPublicState(state)
}

async function clearIdentity(): Promise<PublicExtensionState> {
  const state = await readState()
  delete state.secretKeyHex
  await writeState(state)
  return toPublicState(state)
}

async function saveRelays(relays: string[]): Promise<PublicExtensionState> {
  const state = await readState()
  state.relays = normalizeRelays(relays)
  await writeState(state)
  return toPublicState(state)
}

async function lookupContext(
  targets: AssessmentTarget[],
): Promise<Record<string, ContextSummary>> {
  const state = await readState()
  const targetUrls = [...new Set(targets.map((target) => target.url))]
  let events = state.cachedEvents

  if (targetUrls.length > 0) {
    try {
      const relayEvents = await pool.querySync(
        state.relays,
        {
          kinds: [ATTENTIONX_EVENT_KIND],
          '#L': [ATTENTIONX_LABEL_NAMESPACE],
          '#r': targetUrls,
          limit: Math.min(targetUrls.length * 25, 250),
        },
        { maxWait: 1400 },
      )

      events = mergeEvents(events, relayEvents)
      if (events.length !== state.cachedEvents.length) {
        state.cachedEvents = events
        await writeState(state)
      }
    } catch (error) {
      console.info('AttentionX relay lookup used local cache', error)
    }
  }

  const pubkey = state.secretKeyHex
    ? getPublicKey(hexToBytes(state.secretKeyHex))
    : undefined
  return summarizeAssessments(events, targetUrls, pubkey)
}

function assessmentTargetPayload(target: AssessmentTarget): AssessmentTarget {
  if (target.type === 'profile' && target.twitterId) {
    return {
      type: target.type,
      id: target.id,
      url: target.url,
      twitterId: target.twitterId,
    }
  }

  return {
    type: target.type,
    id: target.id,
    url: target.url,
    handle: target.handle,
    twitterId: target.twitterId,
  }
}

async function publishAssessment(
  target: AssessmentTarget,
  verdict: AssessmentVerdict,
  note?: string,
): Promise<PublishResult> {
  const state = await readState()
  if (!state.secretKeyHex) {
    throw new Error('Create or import a Nostr identity from the AttentionX popup first')
  }

  const event = finalizeEvent(
    {
      kind: ATTENTIONX_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({
        schema: 'attentionx-assessment-v1',
        target: assessmentTargetPayload(target),
        note: note?.trim() || undefined,
      }),
      tags: [
        ['L', ATTENTIONX_LABEL_NAMESPACE],
        ['l', verdict, ATTENTIONX_LABEL_NAMESPACE],
        ['r', target.url],
        ['t', ATTENTIONX_LABEL_NAMESPACE],
      ],
    },
    hexToBytes(state.secretKeyHex),
  )

  state.cachedEvents = mergeEvents(state.cachedEvents, [event])
  await writeState(state)

  const results = await Promise.allSettled(
    pool.publish(state.relays, event, { maxWait: 3500 }),
  )
  const deliveredTo = results.filter((result) => result.status === 'fulfilled').length

  return {
    eventId: event.id,
    deliveredTo,
    attemptedRelays: state.relays.length,
  }
}

async function publishXIdentity(
  handle: string,
  twitterId: string,
  proofTweetId: string,
): Promise<PublishResult> {
  const state = await readState()
  if (!state.secretKeyHex) {
    throw new Error('Create or import a Nostr identity from the AttentionX popup first')
  }

  const event = finalizeEvent(
    {
      kind: NIP39_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: buildNip39TwitterLinkTags(handle, twitterId, proofTweetId),
    },
    hexToBytes(state.secretKeyHex),
  )

  const results = await Promise.allSettled(
    pool.publish(state.relays, event, { maxWait: 3500 }),
  )
  const deliveredTo = results.filter((result) => result.status === 'fulfilled').length

  return {
    eventId: event.id,
    deliveredTo,
    attemptedRelays: state.relays.length,
  }
}

async function handleRequest(request: ExtensionRequest): Promise<unknown> {
  switch (request.type) {
    case 'GET_STATE':
      return toPublicState(await readState())
    case 'GENERATE_IDENTITY':
      return generateIdentity()
    case 'IMPORT_IDENTITY':
      return importIdentity(request.nsec)
    case 'CLEAR_IDENTITY':
      return clearIdentity()
    case 'SAVE_RELAYS':
      return saveRelays(request.relays)
    case 'LOOKUP_CONTEXT':
      return lookupContext(request.targets)
    case 'PUBLISH_ASSESSMENT':
      return publishAssessment(request.target, request.verdict, request.note)
    case 'PUBLISH_X_IDENTITY':
      return publishXIdentity(
        request.handle,
        request.twitterId,
        request.proofTweetId,
      )
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void readState().then(writeState)
})

chrome.runtime.onMessage.addListener(
  (request: ExtensionRequest, _sender, sendResponse) => {
    void handleRequest(request)
      .then((data) => {
        const response: ExtensionResponse<unknown> = { ok: true, data }
        sendResponse(response)
      })
      .catch((error: unknown) => {
        const response: ExtensionResponse<never> = {
          ok: false,
          error: error instanceof Error ? error.message : 'Unexpected AttentionX error',
        }
        sendResponse(response)
      })

    return true
  },
)
