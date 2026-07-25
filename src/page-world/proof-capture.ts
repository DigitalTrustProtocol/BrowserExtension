import {
  isXNumericId,
  normalizeObservedHandle,
} from '../shared/observed-x-identity'
import { proofTextMatches } from '../shared/proof-composer'

export const PROOF_CAPTURE_SOURCE = 'attentionx-proof-capture' as const
export const PROOF_CAPTURE_VERSION = 1 as const

export type ProofCapturePageMessage =
  | {
      source: typeof PROOF_CAPTURE_SOURCE
      version: typeof PROOF_CAPTURE_VERSION
      type: 'enable-proof-capture'
      expectedProofText: string
      expectedHandle?: string
    }
  | {
      source: typeof PROOF_CAPTURE_SOURCE
      version: typeof PROOF_CAPTURE_VERSION
      type: 'disable-proof-capture'
    }

export type ProofCaptureHostMessage = {
  source: typeof PROOF_CAPTURE_SOURCE
  version: typeof PROOF_CAPTURE_VERSION
  type: 'proof-post-created'
  postId: string
  handle?: string
  twitterId?: string
}

export interface CapturedProofPost {
  postId: string
  handle?: string
  twitterId?: string
  fullText: string
}

export function extractCreateTweetProof(
  payload: unknown,
  expectedProofText: string,
  expectedHandle?: string,
): CapturedProofPost | undefined {
  if (!isRecord(payload)) return undefined
  const createTweet =
    readPath(payload, ['data', 'create_tweet']) ??
    readPath(payload, ['data', 'createTweet']) ??
    readPath(payload, ['data', 'notetweet_create'])
  if (!isRecord(createTweet)) return undefined

  const result =
    readPath(createTweet, ['tweet_results', 'result']) ??
    readPath(createTweet, ['tweet_result', 'result']) ??
    createTweet.result
  if (!isRecord(result)) return undefined

  const legacy = isRecord(result.legacy) ? result.legacy : undefined
  const fullText =
    (typeof legacy?.full_text === 'string' && legacy.full_text) ||
    (typeof result.full_text === 'string' && result.full_text) ||
    undefined
  if (!fullText || !proofTextMatches(fullText, expectedProofText)) {
    return undefined
  }

  const postId =
    (isXNumericId(result.rest_id) && result.rest_id) ||
    (isXNumericId(legacy?.id_str) && legacy.id_str) ||
    undefined
  if (!postId) return undefined

  const userResult =
    readPath(result, ['core', 'user_results', 'result']) ??
    readPath(result, ['legacy', 'user'])
  const user = isRecord(userResult) ? userResult : undefined
  const userLegacy = user && isRecord(user.legacy) ? user.legacy : undefined
  const handle = normalizeObservedHandle(
    String(
      userLegacy?.screen_name ??
        user?.screen_name ??
        user?.username ??
        '',
    ),
  )
  const twitterId =
    (user && isXNumericId(user.rest_id) && user.rest_id) || undefined

  if (expectedHandle && handle && handle !== expectedHandle) {
    return undefined
  }

  return {
    postId,
    fullText,
    ...(handle ? { handle } : {}),
    ...(twitterId ? { twitterId } : {}),
  }
}

export function isCreateTweetOperation(operationName: string): boolean {
  return /^(?:CreateTweet|CreateNoteTweet)$/i.test(operationName)
}

function readPath(
  value: unknown,
  path: readonly string[],
): unknown {
  let current: unknown = value
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
