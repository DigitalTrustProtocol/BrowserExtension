import { t } from '@lib/i18n.js'
import type { TrustQueryResult, TrustResolution } from '../../../graph'
import styles from './TrustGiven.module.css'

export type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string

export type PolarTrustResolution = Exclude<TrustResolution, 'none'>

export type TrustClusterLine =
  | { kind: 'empty' }
  | {
      kind: 'present'
      resolution: PolarTrustResolution
      figure: number
      count: number
    }

/** Monochrome Miscellaneous Symbols — text presentation, not emoji widgets. */
const SHIELD_MARK = '\u26E8\uFE0E'
const WARNING_MARK = '\u26A0\uFE0E'

type PolarityMarkKind = Exclude<PolarTrustResolution, 'mixed'>

/** Tight heater. ViewBox crops the peak/point so the filled body owns 1cap. */
const SHIELD_PATH =
  'M7 0 14 3.2v6.4C14 12.8 10.6 15 7 16 3.4 15 0 12.8 0 9.6V3.2Z'
const SHIELD_VIEWBOX = '0 3 14 10'

/** Warning trapezoid — viewBox crops the apex so paint meets cap and baseline. */
const WARNING_PATH = 'M8 0 16 16H0Z'
const WARNING_VIEWBOX = '0 4 16 11'

export function verdictLabelKey(
  resolution: TrustResolution,
): `panel.trustGiven.${TrustResolution}` {
  switch (resolution) {
    case 'trusted':
      return 'panel.trustGiven.trusted'
    case 'distrusted':
      return 'panel.trustGiven.distrusted'
    case 'mixed':
      return 'panel.trustGiven.mixed'
    case 'none':
      return 'panel.trustGiven.none'
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

export function formatVerdictLabel(
  resolution: TrustResolution,
  translate: Translate = t,
): string {
  return translate(verdictLabelKey(resolution))
}

/** Winning-polarity count at the hitting degree. Not a 32014 score. */
export function clusterFigure(
  resolution: PolarTrustResolution,
  trust: number,
  distrust: number,
): number {
  switch (resolution) {
    case 'trusted':
      return trust
    case 'distrusted':
      return distrust
    case 'mixed':
      return trust
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

export function trustClusterLine(
  result: Pick<TrustQueryResult, 'resolution' | 'trust' | 'distrust'>,
): TrustClusterLine {
  if (result.resolution === 'none') return { kind: 'empty' }
  return {
    kind: 'present',
    resolution: result.resolution,
    figure: clusterFigure(result.resolution, result.trust, result.distrust),
    count: result.trust + result.distrust,
  }
}

export function formatClusterCount(
  count: number,
  translate: Translate = t,
): string {
  return translate('panel.trustGiven.count', { count })
}

export function polarityGlyph(resolution: PolarTrustResolution): string {
  switch (resolution) {
    case 'trusted':
      return SHIELD_MARK
    case 'distrusted':
      return WARNING_MARK
    case 'mixed':
      return `${SHIELD_MARK}${WARNING_MARK}`
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

export type ClusterPhraseParts = {
  figure: string
  mark: string
  count: string
}

/** Figure, polarity mark, and (n) as one inline phrase. Mark scale/tracking is CSS. */
export function clusterPhraseParts(
  cluster: Extract<TrustClusterLine, { kind: 'present' }>,
  translate: Translate = t,
): ClusterPhraseParts {
  return {
    figure: String(cluster.figure),
    mark: polarityGlyph(cluster.resolution),
    count: formatClusterCount(cluster.count, translate),
  }
}

export function formatClusterPhrase(
  cluster: Extract<TrustClusterLine, { kind: 'present' }>,
  translate: Translate = t,
): string {
  const { figure, mark, count } = clusterPhraseParts(cluster, translate)
  return `${figure} ${mark} ${count}`
}

export function formatClusterAria(
  cluster: Extract<TrustClusterLine, { kind: 'present' }>,
  translate: Translate = t,
): string {
  return translate('panel.trustGiven.clusterAria', {
    verdict: formatVerdictLabel(cluster.resolution, translate),
    figure: cluster.figure,
    count: cluster.count,
  })
}

function polarityMarkKinds(
  resolution: PolarTrustResolution,
): readonly PolarityMarkKind[] {
  switch (resolution) {
    case 'trusted':
      return ['trusted']
    case 'distrusted':
      return ['distrusted']
    case 'mixed':
      return ['trusted', 'distrusted']
    default: {
      const _exhaustive: never = resolution
      return _exhaustive
    }
  }
}

function PolarityMarkGlyph(props: { kind: PolarityMarkKind }) {
  const { kind } = props
  switch (kind) {
    case 'trusted':
      return (
        <svg
          className={styles.markGlyph}
          data-kind="trusted"
          viewBox={SHIELD_VIEWBOX}
          overflow="hidden"
          aria-hidden="true"
          focusable="false"
        >
          <path d={SHIELD_PATH} />
        </svg>
      )
    case 'distrusted':
      return (
        <svg
          className={styles.markGlyph}
          data-kind="distrusted"
          viewBox={WARNING_VIEWBOX}
          overflow="hidden"
          aria-hidden="true"
          focusable="false"
        >
          <path d={WARNING_PATH} />
        </svg>
      )
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function ClusterStatus(props: { cluster: TrustClusterLine }) {
  const { cluster } = props
  switch (cluster.kind) {
    case 'empty':
      return (
        <p className={styles.empty} role="status">
          {formatVerdictLabel('none')}
        </p>
      )
    case 'present': {
      const { figure, count } = clusterPhraseParts(cluster)
      return (
        <p
          className={styles.cluster}
          role="status"
          aria-label={formatClusterAria(cluster)}
        >
          {figure}
          <span className={styles.mark} aria-hidden="true">
            {polarityMarkKinds(cluster.resolution).map((kind) => (
              <PolarityMarkGlyph key={kind} kind={kind} />
            ))}
          </span>
          {count}
        </p>
      )
    }
    default: {
      const _exhaustive: never = cluster
      return _exhaustive
    }
  }
}

export default function TrustGiven(props: {
  trust: TrustQueryResult
}) {
  const { trust } = props

  return (
    <section className={styles.root} aria-labelledby="trust-given-title">
      <p id="trust-given-title" className={styles.title}>
        {t('panel.trustGiven.title')}
      </p>
      <ClusterStatus cluster={trustClusterLine(trust)} />
      {trust.truncated ? (
        <p className={styles.truncated}>{t('panel.trustGiven.truncated')}</p>
      ) : null}
    </section>
  )
}
