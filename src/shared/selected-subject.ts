import type { TrustSubject } from '../graph'

export const SELECTED_SUBJECT_STORAGE_KEY = 'attentionxSelectedSubject'
export const SELECTED_SUBJECT_CHANGED_MESSAGE = 'SELECTED_SUBJECT_CHANGED' as const

export interface SelectedSubject {
  subject: TrustSubject
  context?: string
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
