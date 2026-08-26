import { t } from '../lib/i18n'
import {
  isGraphDeepLink,
  parseGraphPageUrl,
  type GraphPageMode,
} from '../shared/graph-deeplink'

export type ApplicationTabKind = GraphPageMode | 'application'

export function applicationTabKindFromSearch(search: string): ApplicationTabKind {
  const link = parseGraphPageUrl(search)
  if (!isGraphDeepLink(link)) return 'application'
  return link.mode
}

export function applicationTabTitle(kind: ApplicationTabKind): string {
  return `${t('onboarding.title')} — ${pageLabel(kind)}`
}

export function applyApplicationTabTitle(kind: ApplicationTabKind): void {
  document.title = applicationTabTitle(kind)
}

function pageLabel(kind: ApplicationTabKind): string {
  switch (kind) {
    case 'graph':
      return t('graph.mode.graph')
    case 'path':
      return t('graph.mode.path')
    case 'application':
      return t('settings.cockpit')
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}
