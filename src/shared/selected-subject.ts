import type { TrustSubject } from '../graph'

export const SELECTED_SUBJECT_STORAGE_KEY = 'attentionxSelectedSubject'
export const SELECTED_SUBJECT_HISTORY_STORAGE_KEY =
  'attentionxSelectedSubjectHistory'
export const SELECTED_SUBJECT_CHANGED_MESSAGE = 'SELECTED_SUBJECT_CHANGED' as const
/** Session flag: open Notes when the side panel document mounts after OPEN_SIDE_PANEL. */
export const OPEN_NOTES_ON_LAUNCH_KEY = 'attentionxOpenNotesOnLaunch'
export const SELECTED_SUBJECT_HISTORY_MAX = 50

export type SelectedSubjectHistoryDirection = 'back' | 'forward'

export interface SelectedSubject {
  subject: TrustSubject
  context?: string
}

export interface SelectedSubjectHistory {
  entries: SelectedSubject[]
  index: number
}

export interface SelectedSubjectSnapshot {
  selected: SelectedSubject | null
  canBack: boolean
  canForward: boolean
}

export function isSelectedSubject(value: unknown): value is SelectedSubject {
  if (!value || typeof value !== 'object') return false
  const record = value as { subject?: { type?: unknown; value?: unknown }; context?: unknown }
  const type = record.subject?.type
  const subjectValue = record.subject?.value
  if (type !== 'p' && type !== 'e' && type !== 'i') return false
  if (typeof subjectValue !== 'string' || subjectValue.length === 0) return false
  if (record.context !== undefined && typeof record.context !== 'string') {
    return false
  }
  return true
}

export function emptySelectedSubjectHistory(): SelectedSubjectHistory {
  return { entries: [], index: 0 }
}

export function isSelectedSubjectHistory(
  value: unknown,
): value is SelectedSubjectHistory {
  if (!value || typeof value !== 'object') return false
  const record = value as { entries?: unknown; index?: unknown }
  if (!Array.isArray(record.entries) || record.entries.length > SELECTED_SUBJECT_HISTORY_MAX) {
    return false
  }
  if (typeof record.index !== 'number' || !Number.isInteger(record.index)) {
    return false
  }
  if (record.entries.length === 0) return record.index === 0
  if (record.index < 0 || record.index >= record.entries.length) return false
  return record.entries.every((entry) => isSelectedSubject(entry))
}

/** Identity for history: same user/post, ignoring optional context. */
export function selectedSubjectIdentity(selected: SelectedSubject): string {
  return `${selected.subject.type}:${selected.subject.value}`
}

export function selectedSubjectHistoryFlags(
  history: SelectedSubjectHistory,
): Pick<SelectedSubjectSnapshot, 'canBack' | 'canForward'> {
  if (history.entries.length <= 1) {
    return { canBack: false, canForward: false }
  }
  return {
    canBack: history.index > 0,
    canForward: history.index < history.entries.length - 1,
  }
}

export function pushSelectedSubjectHistory(
  history: SelectedSubjectHistory,
  selected: SelectedSubject,
): SelectedSubjectHistory {
  const identity = selectedSubjectIdentity(selected)
  const current = history.entries[history.index]
  if (current && selectedSubjectIdentity(current) === identity) {
    const entries = history.entries.slice()
    entries[history.index] = selected
    return { entries, index: history.index }
  }
  const truncated = history.entries.slice(0, history.index + 1)
  truncated.push(selected)
  const overflow = truncated.length - SELECTED_SUBJECT_HISTORY_MAX
  if (overflow > 0) {
    return {
      entries: truncated.slice(overflow),
      index: truncated.length - 1 - overflow,
    }
  }
  return { entries: truncated, index: truncated.length - 1 }
}

export function moveSelectedSubjectHistory(
  history: SelectedSubjectHistory,
  direction: SelectedSubjectHistoryDirection,
): SelectedSubjectHistory | undefined {
  switch (direction) {
    case 'back':
      if (history.index <= 0 || history.entries.length === 0) return undefined
      return { entries: history.entries, index: history.index - 1 }
    case 'forward':
      if (history.index >= history.entries.length - 1) return undefined
      return { entries: history.entries, index: history.index + 1 }
    default: {
      const _exhaustive: never = direction
      return _exhaustive
    }
  }
}
