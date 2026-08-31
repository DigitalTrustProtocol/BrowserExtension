import type { PanelSessionSnapshot } from '../../../shared/panel-session'
import type { ActiveXAccountReport } from '../../../shared/proof-composer'

/** Operator X chrome from the panel snapshot — available on first Home paint. */
export function operatorXAccountFromSnapshot(
  snapshot: PanelSessionSnapshot | null | undefined,
): ActiveXAccountReport | undefined {
  if (snapshot?.x.kind !== 'identified') return undefined
  return {
    handle: snapshot.x.handle ?? '',
    twitterId: snapshot.x.twitterId,
    detectedAt: 0,
  }
}

export type OperatorXIdentityLine =
  | { kind: 'pending' }
  | { kind: 'ready'; text: string }

export function operatorXIdentityLine(
  snapshot: PanelSessionSnapshot | null | undefined,
  error?: string,
): OperatorXIdentityLine {
  if (!snapshot) return { kind: 'pending' }
  switch (snapshot.x.kind) {
    case 'unknown':
      return { kind: 'pending' }
    case 'identified': {
      const handle = snapshot.x.handle
      const text = handle
        ? `@${handle} · ${snapshot.x.twitterId}`
        : snapshot.x.twitterId
      return { kind: 'ready', text }
    }
    case 'loggedOut':
      return { kind: 'ready', text: 'Sign in on x.com to detect your account' }
    case 'notApplicable':
      return {
        kind: 'ready',
        text: error ?? 'Open x.com while signed in to detect your account',
      }
    default: {
      const _exhaustive: never = snapshot.x
      return _exhaustive
    }
  }
}

export function operatorXIdentityPending(
  snapshot: PanelSessionSnapshot | null | undefined,
): boolean {
  return operatorXIdentityLine(snapshot).kind === 'pending'
}
