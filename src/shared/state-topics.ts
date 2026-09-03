import {
  PROFILE_METADATA_UPDATED_MESSAGE,
  type ProfileMetadataUpdatedMessage,
  type XIdentityUpdatedMessage,
} from './contracts.ts'
import {
  APP_MODE_CHANGED_MESSAGE,
  isAppMode,
  type AppMode,
} from './app-mode.ts'
import { TRUST_GRAPH_UPDATED_MESSAGE } from './demo-wot.ts'
import {
  PANEL_SESSION_CHANGED_MESSAGE,
  panelSessionSnapshotFromUnknown,
  type PanelSessionSnapshot,
} from './panel-session.ts'
import {
  SELECTED_SUBJECT_CHANGED_MESSAGE,
  isSelectedSubject,
  type SelectedSubject,
} from './selected-subject.ts'
import {
  VIEWER_CHANGED_MESSAGE,
  parseViewerState,
  type ViewerState,
} from './session-actor.ts'
import { WOT_MAX_DEGREE_CHANGED_MESSAGE } from './wot-max-degree.ts'

export interface StateTopicPayloads {
  trustGraph: {}
  viewer: ViewerState
  identity: Omit<XIdentityUpdatedMessage, 'type'>
  appMode: { mode: AppMode }
  wotMaxDegree: { degree: number }
  selectedSubject: SelectedSubject
  profileMetadata: Omit<ProfileMetadataUpdatedMessage, 'type'>
  panelSession: { snapshot: PanelSessionSnapshot }
}

export const STATE_TOPICS = {
  trustGraph: {
    type: TRUST_GRAPH_UPDATED_MESSAGE,
    tabs: true,
  },
  viewer: {
    type: VIEWER_CHANGED_MESSAGE,
    tabs: false,
  },
  identity: {
    type: 'X_IDENTITY_UPDATED',
    tabs: true,
  },
  appMode: {
    type: APP_MODE_CHANGED_MESSAGE,
    tabs: true,
  },
  wotMaxDegree: {
    type: WOT_MAX_DEGREE_CHANGED_MESSAGE,
    tabs: true,
  },
  selectedSubject: {
    type: SELECTED_SUBJECT_CHANGED_MESSAGE,
    tabs: true,
  },
  profileMetadata: {
    type: PROFILE_METADATA_UPDATED_MESSAGE,
    tabs: false,
  },
  panelSession: {
    type: PANEL_SESSION_CHANGED_MESSAGE,
    tabs: false,
  },
} as const satisfies Record<
  keyof StateTopicPayloads,
  { type: string; tabs: boolean }
>

export type StateTopic = keyof typeof STATE_TOPICS

export type StateTopicMessage<T extends StateTopic> = {
  type: (typeof STATE_TOPICS)[T]['type']
} & StateTopicPayloads[T]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTrustGraphMessage(
  value: unknown,
): StateTopicMessage<'trustGraph'> | undefined {
  if (!isRecord(value) || value.type !== STATE_TOPICS.trustGraph.type) {
    return undefined
  }
  return { type: STATE_TOPICS.trustGraph.type }
}

function parseViewerMessage(
  value: unknown,
): StateTopicMessage<'viewer'> | undefined {
  if (!isRecord(value) || value.type !== STATE_TOPICS.viewer.type) {
    return undefined
  }
  const state = parseViewerState(value)
  return state
    ? { type: STATE_TOPICS.viewer.type, ...state }
    : undefined
}

function parseIdentityMessage(
  value: unknown,
): StateTopicMessage<'identity'> | undefined {
  if (!isRecord(value) || value.type !== STATE_TOPICS.identity.type) {
    return undefined
  }
  const state = value.state
  if (
    state !== 'unverified' &&
    state !== 'pending' &&
    state !== 'verified' &&
    state !== 'expired' &&
    state !== 'revoked'
  ) {
    return undefined
  }
  const proofSource = value.proofSource
  if (
    proofSource !== undefined &&
    proofSource !== 'bio' &&
    proofSource !== 'post' &&
    proofSource !== 'nip39' &&
    proofSource !== 'trust32009'
  ) {
    return undefined
  }
  if (
    typeof value.twitterId !== 'string' ||
    typeof value.handle !== 'string' ||
    typeof value.statusChanged !== 'boolean'
  ) {
    return undefined
  }
  return {
    type: STATE_TOPICS.identity.type,
    twitterId: value.twitterId,
    state,
    handle: value.handle,
    statusChanged: value.statusChanged,
    ...(proofSource !== undefined ? { proofSource } : {}),
  }
}

function parseAppModeMessage(
  value: unknown,
): StateTopicMessage<'appMode'> | undefined {
  if (
    !isRecord(value) ||
    value.type !== STATE_TOPICS.appMode.type ||
    !isAppMode(value.mode)
  ) {
    return undefined
  }
  return { type: STATE_TOPICS.appMode.type, mode: value.mode }
}

function parseWotMaxDegreeMessage(
  value: unknown,
): StateTopicMessage<'wotMaxDegree'> | undefined {
  if (
    !isRecord(value) ||
    value.type !== STATE_TOPICS.wotMaxDegree.type ||
    typeof value.degree !== 'number' ||
    !Number.isFinite(value.degree)
  ) {
    return undefined
  }
  return { type: STATE_TOPICS.wotMaxDegree.type, degree: value.degree }
}

function parseSelectedSubjectMessage(
  value: unknown,
): StateTopicMessage<'selectedSubject'> | undefined {
  if (
    !isRecord(value) ||
    value.type !== STATE_TOPICS.selectedSubject.type ||
    !isSelectedSubject(value)
  ) {
    return undefined
  }
  return {
    type: STATE_TOPICS.selectedSubject.type,
    subject: value.subject,
    ...(value.context !== undefined ? { context: value.context } : {}),
  }
}

function parseProfileMetadataMessage(
  value: unknown,
): StateTopicMessage<'profileMetadata'> | undefined {
  if (
    !isRecord(value) ||
    value.type !== STATE_TOPICS.profileMetadata.type ||
    typeof value.pubkey !== 'string'
  ) {
    return undefined
  }
  return {
    type: STATE_TOPICS.profileMetadata.type,
    pubkey: value.pubkey,
  }
}

function parsePanelSessionMessage(
  value: unknown,
): StateTopicMessage<'panelSession'> | undefined {
  if (
    !isRecord(value) ||
    value.type !== STATE_TOPICS.panelSession.type
  ) {
    return undefined
  }
  const snapshot = panelSessionSnapshotFromUnknown(value.snapshot)
  return snapshot
    ? { type: STATE_TOPICS.panelSession.type, snapshot }
    : undefined
}

type AnyStateTopicMessage = {
  [T in StateTopic]: StateTopicMessage<T>
}[StateTopic]

export function parseStateTopicMessage<T extends StateTopic>(
  topic: T,
  value: unknown,
): StateTopicMessage<T> | undefined
export function parseStateTopicMessage(
  topic: StateTopic,
  value: unknown,
): AnyStateTopicMessage | undefined {
  switch (topic) {
    case 'trustGraph':
      return parseTrustGraphMessage(value)
    case 'viewer':
      return parseViewerMessage(value)
    case 'identity':
      return parseIdentityMessage(value)
    case 'appMode':
      return parseAppModeMessage(value)
    case 'wotMaxDegree':
      return parseWotMaxDegreeMessage(value)
    case 'selectedSubject':
      return parseSelectedSubjectMessage(value)
    case 'profileMetadata':
      return parseProfileMetadataMessage(value)
    case 'panelSession':
      return parsePanelSessionMessage(value)
    default: {
      const _exhaustive: never = topic
      return _exhaustive
    }
  }
}

export function stateTopicMessage<T extends StateTopic>(
  topic: T,
  payload?: StateTopicPayloads[T],
): StateTopicMessage<T> {
  return {
    type: STATE_TOPICS[topic].type,
    ...(payload ?? {}),
  } as StateTopicMessage<T>
}

export type StateTopicHandler<T extends StateTopic> = (
  message: StateTopicMessage<T>,
) => void

export function subscribeStateTopic<T extends StateTopic>(
  topic: T,
  handler: StateTopicHandler<T>,
): () => void {
  const onMessage = (value: unknown): void => {
    const message = parseStateTopicMessage(topic, value)
    if (message) handler(message)
  }
  chrome.runtime.onMessage.addListener(onMessage)
  return () => chrome.runtime.onMessage.removeListener(onMessage)
}
