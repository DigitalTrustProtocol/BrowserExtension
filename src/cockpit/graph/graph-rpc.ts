import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type GraphNeighborhood,
  type GraphNeighborhoodDirection,
  type GraphNeighborhoodValueFilter,
  type GraphSnapshot,
  type PublishResult,
  type QueryTrustBatchItem,
  type QueryTrustBatchResult,
  type SerializableTrustSubject,
  type ActiveXAccountReport,
  type XIdentityDisplay,
  type XPostDisplay,
} from '../../shared/contracts'
import type { GraphVisId, RatingQueryResult, TrustQueryResult } from '../../graph'
import { rpc } from '../../shared/rpc'

/** Max identities/posts per display RPC (matches backend batch caps). */
export const GRAPH_DISPLAY_BATCH = 50

async function send<T>(payload: Record<string, unknown>): Promise<T> {
  const response = (await chrome.runtime.sendMessage({
    version: BACKGROUND_API_VERSION,
    ...payload,
  })) as ExtensionResponse<T>
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Request failed')
  }
  return response.data
}

export function closeGraphPage(): Promise<{ closed: true }> {
  return send<{ closed: true }>({ type: 'CLOSE_GRAPH_PAGE' })
}

export function loadGraphSnapshot(options?: {
  maxDepth?: number
  maxNodes?: number
  context?: string
}): Promise<GraphSnapshot> {
  return send<GraphSnapshot>({
    type: 'GET_GRAPH_SNAPSHOT',
    maxDepth: options?.maxDepth ?? 1,
    maxNodes: options?.maxNodes ?? 50,
    ...(options?.context ? { context: options.context } : {}),
  })
}

export function loadNeighborhood(options: {
  centerId: GraphVisId
  direction?: GraphNeighborhoodDirection
  valueFilter?: GraphNeighborhoodValueFilter
  context?: string
  limit?: number
}): Promise<GraphNeighborhood> {
  return send<GraphNeighborhood>({
    type: 'GET_GRAPH_NEIGHBORHOOD',
    centerId: options.centerId,
    direction: options.direction ?? 'both',
    valueFilter: options.valueFilter ?? 'both',
    ...(options.context ? { context: options.context } : {}),
    limit: options.limit ?? 200,
  })
}

export function queryTrust(options: {
  subject: SerializableTrustSubject
  context?: string
  format?: 'default' | 'path'
}): Promise<TrustQueryResult> {
  return send<TrustQueryResult>({
    type: 'QUERY_TRUST',
    subject: options.subject,
    ...(options.context ? { context: options.context } : {}),
    ...(options.format ? { format: options.format } : {}),
  })
}

export function queryRating(options: {
  subject: SerializableTrustSubject
  context?: string
  format?: 'default' | 'path'
}): Promise<RatingQueryResult> {
  return send<RatingQueryResult>({
    type: 'QUERY_RATING',
    subject: options.subject,
    ...(options.context ? { context: options.context } : {}),
    ...(options.format ? { format: options.format } : {}),
  })
}

export function queryTrustBatch(
  items: QueryTrustBatchItem[],
): Promise<QueryTrustBatchResult> {
  return send<QueryTrustBatchResult>({
    type: 'QUERY_TRUST_BATCH',
    items,
  })
}

export function publishTrust(options: {
  subject: SerializableTrustSubject
  value: '1' | '0' | '-1'
  context?: string
}): Promise<PublishResult> {
  return send<PublishResult>({
    type: 'PUBLISH_TRUST_STATEMENT',
    subject: options.subject,
    value: options.value,
    ...(options.context ? { context: options.context } : {}),
  })
}

export function cancelTrust(options: {
  subject: SerializableTrustSubject
  context?: string
}): Promise<PublishResult> {
  return send<PublishResult>({
    type: 'CANCEL_TRUST_STATEMENT',
    subject: options.subject,
    ...(options.context ? { context: options.context } : {}),
  })
}

export interface GraphProfileDisplay {
  name?: string
  picture?: string
}

export async function loadProfileDisplays(
  pubkeys: string[],
): Promise<Record<string, GraphProfileDisplay>> {
  if (pubkeys.length === 0) return {}
  const metadata = await rpc<
    Record<string, Record<string, unknown> | null>
  >('getProfileMetadataBatch', {
    pubkeys: pubkeys.slice(0, GRAPH_DISPLAY_BATCH),
  })
  const profiles: Record<string, GraphProfileDisplay> = {}
  for (const [pubkey, profile] of Object.entries(metadata ?? {})) {
    const picture = profile?.picture
    const displayName =
      typeof profile?.display_name === 'string'
        ? profile.display_name
        : typeof profile?.name === 'string'
          ? profile.name
          : undefined
    const safeName = displayName?.trim().slice(0, 80)
    const safePicture =
      typeof picture === 'string' &&
      /^https?:\/\//i.test(picture) &&
      picture.length <= 2_048
        ? picture
        : undefined
    if (safeName || safePicture) {
      profiles[pubkey] = {
        ...(safeName ? { name: safeName } : {}),
        ...(safePicture ? { picture: safePicture } : {}),
      }
    }
  }
  return profiles
}

export async function loadXIdentityDisplays(
  twitterIds: string[],
): Promise<Record<string, XIdentityDisplay>> {
  if (twitterIds.length === 0) return {}
  return send<Record<string, XIdentityDisplay>>({
    type: 'GET_X_IDENTITY_DISPLAYS',
    twitterIds: twitterIds.slice(0, GRAPH_DISPLAY_BATCH),
  })
}

export async function loadXIdentityDisplaysForPubkeys(
  pubkeys: string[],
): Promise<Record<string, XIdentityDisplay>> {
  if (pubkeys.length === 0) return {}
  return send<Record<string, XIdentityDisplay>>({
    type: 'GET_X_IDENTITY_DISPLAYS_FOR_PUBKEYS',
    pubkeys: pubkeys.slice(0, GRAPH_DISPLAY_BATCH),
  })
}

export async function loadXPostDisplays(
  postIds: string[],
): Promise<Record<string, XPostDisplay>> {
  if (postIds.length === 0) return {}
  return send<Record<string, XPostDisplay>>({
    type: 'GET_X_POST_DISPLAYS',
    postIds: postIds.slice(0, GRAPH_DISPLAY_BATCH),
  })
}

export async function loadActiveXAccount(): Promise<
  ActiveXAccountReport | undefined
> {
  return send<ActiveXAccountReport | undefined>({
    type: 'GET_ACTIVE_X_ACCOUNT',
  })
}

export function openSidePanel(options: {
  subject: SerializableTrustSubject
  context?: string
}): Promise<{ opened: boolean; subject: SerializableTrustSubject }> {
  return send<{ opened: boolean; subject: SerializableTrustSubject }>({
    type: 'OPEN_SIDE_PANEL',
    subject: options.subject,
    ...(options.context ? { context: options.context } : {}),
  })
}
