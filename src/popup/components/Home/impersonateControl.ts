export type ImpersonateControlKind = 'hidden' | 'impersonate' | 'revert'

const TWITTER_ID = /^\d+$/

export function impersonateControlState(input: {
  demoMode: boolean
  panelKind: 'user' | 'post'
  subjectTwitterId: string | null
  operatorTwitterId: string | null
  impersonating: boolean
}): ImpersonateControlKind {
  if (input.impersonating) return 'revert'
  if (!input.demoMode) return 'hidden'
  if (input.panelKind !== 'user') return 'hidden'
  const subjectId = input.subjectTwitterId?.trim() ?? ''
  if (!TWITTER_ID.test(subjectId)) return 'hidden'
  const operatorId = input.operatorTwitterId?.trim() ?? ''
  if (operatorId.length > 0 && operatorId === subjectId) return 'hidden'
  return 'impersonate'
}
