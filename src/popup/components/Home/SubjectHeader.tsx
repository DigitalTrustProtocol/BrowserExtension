import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  IconChevronLeft,
  IconChevronRight,
  IconLayers,
  IconMerge,
  IconPost,
  IconStar,
  IconUndo,
  IconUser,
} from '@assets'
import XUserBadges from '@components/XUserBadges/XUserBadges'
import { t } from '@lib/i18n.js'
import { safeImageUrl } from '@shared/safeUrl.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
  type XPostDisplay,
} from '../../../shared/contracts'
import type { RatingQueryResult, TrustQueryResult } from '../../../graph'
import { formatTrustScore } from '../../../shared/trust-score-format'
import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import { canonicalTwitterPostUrl, canonicalTwitterProfileUrl } from '../../../shared/x-identity'
import {
  IDENTITY_TRUST_CONTEXT,
} from '../../../shared/trust-context'
import {
  isUnboundPubkeySubject,
  twitterIdFromSubject,
} from '../../../shared/selected-ids'
import { useUser } from '../../../shared/hooks/useUser'
import { npubFromPubkey } from '../../../identity/x-identity-row'
import type { XPostRole } from '../../../shared/x-post-chrome'
import type { XVerifiedType } from '../../../shared/x-verified'
import { subscribeStateTopic } from '../../../shared/state-topics.ts'
import {
  avatarFallbackLetter,
  formatAtHandle,
  formatPostSubjectHeader,
  formatUserSubjectHeader,
  unidentifiedAccountHeader,
  unboundPubkeyHeader,
  nameTrustTone,
  type NameTrustTone,
  subjectAvatarUrl,
  subjectHeaderKind,
  subjectHeroPictureUrl,
  trustScoreSummaryFromQuery,
  postHeaderRatingView,
  postRoleLabel,
} from './subjectHeaderFormat'
import type { ImpersonateControlKind } from './impersonateControl'
import TrustScoreBoard from './TrustScoreBoard'
import styles from './SubjectHeader.module.css'

async function axRequest<T>(request: ExtensionRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(
    request,
  )) as ExtensionResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

interface IdentityChromeRow {
  displayName?: string
  handle?: string
  postHandle?: string
  bannerPath?: string
  iconPath?: string
  verifiedType?: XVerifiedType
  affiliationBadgePath?: string
  affiliationLabel?: string
}

function identityHandle(row: IdentityChromeRow): string | undefined {
  const handle = row.handle?.trim() || row.postHandle?.trim()
  return handle || undefined
}

async function loadIdentityRow(
  twitterId: string,
): Promise<IdentityChromeRow | undefined> {
  const result = await axRequest<
    { identity?: IdentityChromeRow } | undefined
  >({
    type: 'GET_X_IDENTITY',
    version: BACKGROUND_API_VERSION,
    twitterId,
  })
  return result?.identity
}

function CoverPhoto(props: {
  src: string | undefined
  loading: boolean
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const safeSrc = safeImageUrl(props.src)
  const showImg = Boolean(safeSrc) && !imgFailed

  if (showImg && safeSrc) {
    return (
      <img
        className={styles.photo}
        src={safeSrc}
        alt=""
        fetchPriority="high"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={`${styles.fallback}${props.loading ? ` ${styles.pulse}` : ''}`}
      aria-hidden="true"
    />
  )
}

function FacePhoto(props: {
  src: string | undefined
  loading: boolean
  letter: string
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const safeSrc = safeImageUrl(props.src)
  const showImg = Boolean(safeSrc) && !imgFailed

  if (showImg && safeSrc) {
    return (
      <img
        className={styles.avatarImg}
        src={safeSrc}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={`${styles.avatarFallback}${props.loading ? ` ${styles.pulse}` : ''}`}
      aria-hidden="true"
    >
      {props.loading ? null : props.letter || '?'}
    </div>
  )
}

function underlineToneClass(tone: NameTrustTone | undefined): string {
  switch (tone) {
    case 'trust':
      return styles.titleTrust
    case 'question':
      return styles.titleQuestion
    case 'misleading':
      return styles.titleMisleading
    case undefined:
      return ''
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

function scoreToneClass(tone: NameTrustTone | undefined): string {
  switch (tone) {
    case 'trust':
      return styles.scoreTrust
    case 'question':
      return styles.scoreQuestion
    case 'misleading':
      return styles.scoreMisleading
    case undefined:
      return ''
    default: {
      const _exhaustive: never = tone
      return _exhaustive
    }
  }
}

interface DisplayChrome {
  displayName?: string
  handle?: string
  bannerPath?: string
  iconPath?: string
  verifiedType?: XVerifiedType
  affiliationBadgePath?: string
  affiliationLabel?: string
  headline?: string
  authorHandle?: string
  authorTwitterId?: string
  role?: XPostRole
}

function accountProfileHref(input: {
  twitterId?: string
  handle?: string
}): string | undefined {
  const handle = input.handle?.trim()
  if (handle) {
    try {
      return canonicalTwitterProfileUrl({ handle })
    } catch {
      // Invalid stored handle — fall through to the numeric-id URL.
    }
  }
  const twitterId = input.twitterId?.trim()
  if (!twitterId) return undefined
  try {
    return canonicalTwitterProfileUrl({ twitterId })
  } catch {
    return undefined
  }
}

function impersonateControlButton(
  control: ImpersonateControlKind,
  onImpersonate: () => void,
  onRevert: () => void,
) {
  switch (control) {
    case 'hidden':
      return null
    case 'impersonate':
      return (
        <button
          type="button"
          className={styles.graphAction}
          title={t('panel.subjectHeader.impersonateHint')}
          aria-label={t('panel.subjectHeader.impersonate')}
          onClick={onImpersonate}
        >
          <IconUser size={14} aria-hidden="true" />
          <span>{t('panel.subjectHeader.impersonate')}</span>
        </button>
      )
    case 'revert':
      return (
        <button
          type="button"
          className={styles.graphAction}
          title={t('panel.subjectHeader.revertImpersonation')}
          aria-label={t('panel.subjectHeader.revertImpersonation')}
          onClick={onRevert}
        >
          <IconUndo size={14} aria-hidden="true" />
          <span>{t('panel.subjectHeader.revertImpersonation')}</span>
        </button>
      )
    default: {
      const _exhaustive: never = control
      return _exhaustive
    }
  }
}

export function SubjectHistory(props: {
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
}) {
  const { canGoBack, canGoForward, onGoBack, onGoForward } = props
  return (
    <div
      className={styles.history}
      role="group"
      aria-label={t('panel.subjectHeader.history')}
    >
      <button
        type="button"
        className={styles.historyBtn}
        disabled={!canGoBack}
        aria-label={t('panel.subjectHeader.historyBack')}
        onClick={onGoBack}
      >
        <IconChevronLeft size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.historyBtn}
        disabled={!canGoForward}
        aria-label={t('panel.subjectHeader.historyForward')}
        onClick={onGoForward}
      >
        <IconChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function SubjectHeader(props: {
  subject: SerializableTrustSubject
  trust: TrustQueryResult | null
  rating: RatingQueryResult | null
  showHistory: boolean
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
  onPath: () => void
  onGraph: () => void
  demoMode: boolean
  control: ImpersonateControlKind
  onImpersonate: () => void
  onRevert: () => void
}) {
  const {
    subject,
    trust,
    rating,
    showHistory,
    canGoBack,
    canGoForward,
    onGoBack,
    onGoForward,
    onPath,
    onGraph,
    demoMode,
    control,
    onImpersonate,
    onRevert,
  } = props
  const kind = subjectHeaderKind(subject.value)
  const twitterId = twitterIdFromSubject(subject)
  const unboundPubkey = isUnboundPubkeySubject(subject)
  const { user, loading: userLoading } = useUser(twitterId)
  const scoreBoardId = useId()
  const [loadedSubject, setLoadedSubject] = useState(subject.value)
  const [loading, setLoading] = useState(kind !== 'unknown')
  const [display, setDisplay] = useState<DisplayChrome>({})
  const [authorTrust, setAuthorTrust] = useState<TrustQueryResult | null>(null)
  const loadGen = useRef(0)

  if (subject.value !== loadedSubject) {
    setLoadedSubject(subject.value)
    setDisplay({})
    setAuthorTrust(null)
    setLoading(subjectHeaderKind(subject.value) !== 'unknown')
    loadGen.current += 1
  }

  const loadChrome = useCallback(async () => {
    const gen = ++loadGen.current
    const stillCurrent = (): boolean => loadGen.current === gen
    const parsed = parseCanonicalTwitterSubject(subject.value)
    if (!parsed) {
      if (!stillCurrent()) return
      setDisplay({})
      setAuthorTrust(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      switch (parsed.type) {
        case 'account': {
          setAuthorTrust(null)
          setDisplay({})
          break
        }
        case 'post': {
          const displays = await axRequest<Record<string, XPostDisplay>>({
            type: 'GET_X_POST_DISPLAYS',
            version: BACKGROUND_API_VERSION,
            postIds: [parsed.postId],
          })
          if (!stillCurrent()) return
          const postDisplay = displays[parsed.postId]
          if (!postDisplay) {
            // Retracting the last rating may prune xPosts; keep last chrome so
            // the still-selected Post panel can be rated again.
            break
          }
          const authorTwitterId = postDisplay.authorTwitterId?.trim()
          let identity: IdentityChromeRow | undefined
          let nextAuthorTrust: TrustQueryResult | null = null
          if (authorTwitterId) {
            const [identityRow, trustResult] = await Promise.all([
              loadIdentityRow(authorTwitterId),
              axRequest<TrustQueryResult>({
                type: 'QUERY_TRUST',
                version: BACKGROUND_API_VERSION,
                subject: { type: 'i', value: `user:id:${authorTwitterId}` },
                context: IDENTITY_TRUST_CONTEXT,
              }).catch(() => null),
            ])
            if (!stillCurrent()) return
            identity = identityRow
            nextAuthorTrust = trustResult
          }
          const handle =
            (identity ? identityHandle(identity) : undefined) ||
            postDisplay.authorHandle?.trim()
          setAuthorTrust(nextAuthorTrust)
          setDisplay({
            ...(postDisplay.headline ? { headline: postDisplay.headline } : {}),
            ...(postDisplay.authorHandle
              ? { authorHandle: postDisplay.authorHandle }
              : {}),
            ...(postDisplay.role ? { role: postDisplay.role } : {}),
            ...(authorTwitterId ? { authorTwitterId } : {}),
            ...(identity?.displayName
              ? { displayName: identity.displayName }
              : {}),
            ...(handle ? { handle } : {}),
            ...(identity?.bannerPath ? { bannerPath: identity.bannerPath } : {}),
            ...(identity?.iconPath ? { iconPath: identity.iconPath } : {}),
            ...(identity?.verifiedType
              ? { verifiedType: identity.verifiedType }
              : {}),
            ...(identity?.affiliationBadgePath
              ? { affiliationBadgePath: identity.affiliationBadgePath }
              : {}),
            ...(identity?.affiliationLabel
              ? { affiliationLabel: identity.affiliationLabel }
              : {}),
          })
          break
        }
        default: {
          const _exhaustive: never = parsed
          return _exhaustive
        }
      }
    } catch {
      if (!stillCurrent()) return
      setDisplay({})
      setAuthorTrust(null)
    } finally {
      if (stillCurrent()) setLoading(false)
    }
  }, [subject.value])

  useEffect(() => {
    void loadChrome()
  }, [loadChrome])

  useEffect(() => {
    const parsed = parseCanonicalTwitterSubject(subject.value)
    const twitterId =
      parsed?.type === 'account'
        ? parsed.twitterId
        : parsed?.type === 'post'
          ? display.authorTwitterId
          : undefined
    const stopTrustGraph = subscribeStateTopic('trustGraph', (message) => {
      if (message.scope === 'ratings') return
      void loadChrome()
    })
    const stopIdentity = subscribeStateTopic('identity', (message) => {
      if (!twitterId || message.twitterId !== twitterId) return
      void loadChrome()
    })
    return () => {
      stopTrustGraph()
      stopIdentity()
    }
  }, [display.authorTwitterId, loadChrome, subject.value])

  const userNoun = t('panel.subjectHeader.user')
  const postNoun = t('panel.subjectHeader.post')
  const unknownNoun = t('panel.subjectHeader.unknown')
  const parsed = parseCanonicalTwitterSubject(subject.value)
  const accountChrome: DisplayChrome =
    kind === 'account' && user
      ? {
          ...(user.displayName ? { displayName: user.displayName } : {}),
          ...(identityHandle(user) ? { handle: identityHandle(user) } : {}),
          ...(user.bannerPath ? { bannerPath: user.bannerPath } : {}),
          ...(user.iconPath ? { iconPath: user.iconPath } : {}),
          ...(user.verifiedType ? { verifiedType: user.verifiedType } : {}),
          ...(user.affiliationBadgePath
            ? { affiliationBadgePath: user.affiliationBadgePath }
            : {}),
          ...(user.affiliationLabel
            ? { affiliationLabel: user.affiliationLabel }
            : {}),
        }
      : display
  const chromeLoading = kind === 'account' ? userLoading : loading
  const renderedDisplay = kind === 'account' ? accountChrome : display

  let title = unknownNoun
  let subtitle = ''
  let authorName = ''
  let hint = ''
  let profileHref: string | undefined
  switch (kind) {
    case 'account': {
      if (chromeLoading || parsed?.type !== 'account') {
        title = userNoun
        break
      }
      const hasChrome = Boolean(
        renderedDisplay.displayName || renderedDisplay.handle,
      )
      if (!hasChrome) {
        const unidentified = unidentifiedAccountHeader(parsed.twitterId, {
          unknownUser: t('panel.subjectHeader.unknownUser'),
          notIdentifiedYet: t('panel.subjectHeader.notIdentifiedYet'),
        })
        title = unidentified.title
        subtitle = unidentified.subtitle
        hint = unidentified.hint
        profileHref = unidentified.profileHref
        break
      }
      const lines = formatUserSubjectHeader({
        twitterId: parsed.twitterId,
        displayName: renderedDisplay.displayName,
        handle: renderedDisplay.handle,
        userNoun,
      })
      title = lines.title
      subtitle = lines.subtitle
      profileHref = accountProfileHref({
        twitterId: parsed.twitterId,
        handle: renderedDisplay.handle,
      })
      break
    }
    case 'post': {
      if (loading || parsed?.type !== 'post') {
        title = postNoun
        break
      }
      const lines = formatPostSubjectHeader({
        postId: parsed.postId,
        headline: display.headline,
        authorHandle: display.authorHandle ?? display.handle,
        displayName: display.displayName,
        roleLabel: postRoleLabel(display.role, {
          reply: t('panel.subjectHeader.role.reply'),
          quote: t('panel.subjectHeader.role.quote'),
          repost: t('panel.subjectHeader.role.repost'),
        }),
        postNoun,
        handleAndRole: t('panel.subjectHeader.handleAndRole'),
      })
      title = lines.title
      subtitle = lines.subtitle
      authorName = lines.authorName
      profileHref = accountProfileHref({
        twitterId: display.authorTwitterId,
        handle: display.handle,
      })
      break
    }
    case 'unknown':
      if (unboundPubkey) {
        const external = unboundPubkeyHeader(
          npubFromPubkey(subject.value) ?? subject.value,
          {
            externalTrusted: t('panel.subjectHeader.externalTrusted'),
            notIdentifiedYet: t('panel.subjectHeader.notIdentifiedYet'),
          },
        )
        title = external.title
        subtitle = external.subtitle
        hint = external.hint
        break
      }
      title = unknownNoun
      break
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      title = unknownNoun
    }
  }

  const picture = chromeLoading
    ? undefined
    : subjectHeroPictureUrl(renderedDisplay.bannerPath)
  const avatar = chromeLoading
    ? undefined
    : subjectAvatarUrl(renderedDisplay.iconPath)
  const isAccount = kind === 'account'
  const isPost = kind === 'post'
  const postHandle = isPost ? formatAtHandle(display.handle) : undefined
  const namedAuthor = Boolean(display.displayName?.trim())
  const handleProfile =
    isPost && namedAuthor && postHandle && profileHref ? postHandle : undefined
  const authorPanelId =
    isPost && /^\d+$/.test(display.authorTwitterId?.trim() ?? '')
      ? display.authorTwitterId?.trim()
      : undefined
  const postPageHref =
    parsed?.type === 'post' && /^\d+$/.test(parsed.postId)
      ? canonicalTwitterPostUrl(parsed.postId)
      : undefined
  const showProfileChrome = isAccount || isPost
  const letter = avatarFallbackLetter(isPost ? authorName || title : title)
  const nameTone = isPost
    ? authorTrust
      ? nameTrustTone(authorTrust.resolution)
      : undefined
    : trust
      ? nameTrustTone(trust.resolution)
      : undefined
  const scoreSummary =
    isAccount && trust && !chromeLoading
      ? trustScoreSummaryFromQuery(trust)
      : undefined
  const scoreText = scoreSummary
    ? formatTrustScore(scoreSummary, t, { empty: 'noConnection' })
    : undefined
  const ratingView =
    isPost && !chromeLoading ? postHeaderRatingView(rating, t) : undefined
  const scoreTone = ratingView
    ? ratingView.tone
    : isAccount && trust
      ? nameTrustTone(trust.resolution)
      : undefined
  const ariaLabel = chromeLoading
    ? t('panel.subjectHeader.loading')
    : [title, authorName, subtitle, hint].filter(Boolean).join(', ')
  const titleClass = [
    styles.titleText,
    isAccount ? underlineToneClass(nameTone) : '',
  ]
    .filter(Boolean)
    .join(' ')
  const authorClass = [styles.authorName, underlineToneClass(nameTone)]
    .filter(Boolean)
    .join(' ')
  const scoreClass = [styles.score, scoreToneClass(scoreTone)]
    .filter(Boolean)
    .join(' ')

  return (
    <header
      className={styles.root}
      aria-label={ariaLabel}
      aria-busy={chromeLoading}
    >
      <div className={showProfileChrome ? styles.heroAccount : styles.hero}>
        {showProfileChrome ? (
          <div className={styles.bannerClip}>
            <CoverPhoto
              key={picture ?? subject.value}
              src={picture}
              loading={loading}
            />
          </div>
        ) : (
          <CoverPhoto
            key={picture ?? subject.value}
            src={picture}
            loading={loading}
          />
        )}
        {showHistory || demoMode ? (
          <div className={styles.heroLeft}>
            {showHistory ? (
              <SubjectHistory
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                onGoBack={onGoBack}
                onGoForward={onGoForward}
              />
            ) : null}
            {demoMode ? (
              <p className={styles.demoModeLabel} role="status">
                {t('panel.demoMode')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {showProfileChrome ? (
        <div className={styles.avatarRow}>
          <div className={styles.avatarWrap}>
            <FacePhoto
              key={avatar ?? `face:${subject.value}`}
              src={avatar}
              loading={chromeLoading}
              letter={letter}
            />
          </div>
        </div>
      ) : null}
      <div className={showProfileChrome ? styles.textAccount : styles.text}>
        <div className={styles.nameRow}>
          <div className={styles.titleCluster}>
            <h2 className={styles.title} title={title}>
              {isAccount && profileHref && !chromeLoading && !subtitle ? (
                <a
                  className={`${titleClass} ${styles.titleProfileLink}`}
                  href={profileHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  {title}
                </a>
              ) : (
                <span className={titleClass}>{title}</span>
              )}
              <XUserBadges
                size={20}
                {...(isAccount && renderedDisplay.verifiedType
                  ? { verifiedType: renderedDisplay.verifiedType }
                  : {})}
                {...(isAccount && renderedDisplay.affiliationBadgePath
                  ? {
                      affiliationBadgePath:
                        renderedDisplay.affiliationBadgePath,
                    }
                  : {})}
                {...(isAccount && renderedDisplay.affiliationLabel
                  ? { affiliationLabel: renderedDisplay.affiliationLabel }
                  : {})}
              />
            </h2>
          </div>
          {scoreText && scoreSummary ? (
            <span
              className={styles.scoreWrap}
              tabIndex={0}
              aria-describedby={scoreBoardId}
            >
              <span className={scoreClass}>{scoreText}</span>
              <span
                id={scoreBoardId}
                className={styles.scoreBoard}
                role="tooltip"
              >
                <TrustScoreBoard summary={scoreSummary} />
              </span>
            </span>
          ) : ratingView ? (
            <span
              className={styles.scoreWrap}
              {...(ratingView.popup
                ? { tabIndex: 0, 'aria-describedby': scoreBoardId }
                : {})}
            >
              <span className={scoreClass}>
                {ratingView.label}
                {ratingView.stars !== undefined ? (
                  <span className={styles.scoreStars}>
                    {ratingView.stars}
                    <IconStar size={14} />
                  </span>
                ) : null}
              </span>
              {ratingView.popup ? (
                <span
                  id={scoreBoardId}
                  className={styles.scoreBoard}
                  role="tooltip"
                >
                  {ratingView.popup}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {isPost && authorName ? (
          <p className={authorClass} title={authorName}>
            {profileHref && !namedAuthor ? (
              <a
                className={`${styles.authorNameText} ${styles.titleProfileLink}`}
                href={profileHref}
                target="_blank"
                rel="noreferrer"
              >
                {authorName}
              </a>
            ) : (
              <span className={styles.authorNameText}>{authorName}</span>
            )}
            <XUserBadges
              size={16}
              {...(renderedDisplay.verifiedType
                ? { verifiedType: renderedDisplay.verifiedType }
                : {})}
              {...(renderedDisplay.affiliationBadgePath
                ? { affiliationBadgePath: renderedDisplay.affiliationBadgePath }
                : {})}
              {...(renderedDisplay.affiliationLabel
                ? { affiliationLabel: renderedDisplay.affiliationLabel }
                : {})}
            />
          </p>
        ) : null}
        {chromeLoading ? (
          <span className={`${styles.subtitleSkeleton} ${styles.pulse}`} />
        ) : isAccount && subtitle && profileHref ? (
          <a
            className={styles.profileLink}
            href={profileHref}
            target="_blank"
            rel="noreferrer"
            title={subtitle}
          >
            {subtitle}
          </a>
        ) : handleProfile && profileHref ? (
          <p className={styles.subtitle} title={subtitle}>
            <a
              className={styles.profileLink}
              href={profileHref}
              target="_blank"
              rel="noreferrer"
            >
              {handleProfile}
            </a>
            {subtitle.startsWith(handleProfile)
              ? subtitle.slice(handleProfile.length)
              : ''}
          </p>
        ) : subtitle ? (
          <p className={styles.subtitle} title={subtitle}>
            {subtitle}
          </p>
        ) : null}
        {hint && !chromeLoading ? (
          <p className={styles.hint}>{hint}</p>
        ) : null}
        <div className={styles.actionRow}>
          {authorPanelId ? (
            <button
              type="button"
              className={styles.graphAction}
              onClick={() => {
                void axRequest({
                  type: 'SELECT_SUBJECT',
                  version: BACKGROUND_API_VERSION,
                  subject: { type: 'i', value: `user:id:${authorPanelId}` },
                }).catch(() => undefined)
              }}
            >
              <IconUser size={14} aria-hidden="true" />
              <span>{t('panel.subjectHeader.user')}</span>
            </button>
          ) : control !== 'hidden' ? (
            impersonateControlButton(control, onImpersonate, onRevert)
          ) : postPageHref ? null : (
            <span className={styles.actionSpacer} />
          )}
          {postPageHref ? (
            <a
              className={styles.graphAction}
              href={postPageHref}
              target="_blank"
              rel="noreferrer"
            >
              <IconPost size={14} aria-hidden="true" />
              <span>{t('panel.subjectHeader.post')}</span>
            </a>
          ) : null}
          <div className={styles.graphActions}>
            <button
              type="button"
              className={styles.graphAction}
              onClick={onPath}
            >
              <IconMerge size={14} aria-hidden="true" />
              <span>{t('panel.path')}</span>
            </button>
            <button
              type="button"
              className={styles.graphAction}
              onClick={onGraph}
            >
              <IconLayers size={14} aria-hidden="true" />
              <span>{t('panel.graph')}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
