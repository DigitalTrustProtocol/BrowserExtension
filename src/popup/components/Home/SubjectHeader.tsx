import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@lib/i18n.js'
import { safeImageUrl } from '@shared/safeUrl.js'
import {
  BACKGROUND_API_VERSION,
  type ExtensionRequest,
  type ExtensionResponse,
  type SerializableTrustSubject,
  type XIdentityUpdatedMessage,
  type XPostDisplay,
} from '../../../shared/contracts'
import { parseCanonicalTwitterSubject } from '../../../shared/x-identity'
import type { XPostRole } from '../../../shared/x-post-chrome'
import {
  avatarFallbackLetter,
  formatPostSubjectHeader,
  formatUserSubjectHeader,
  postRoleLabel,
  subjectHeaderKind,
  subjectHeroPictureUrl,
} from './subjectHeaderFormat'
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

function PostGlyph() {
  return (
    <svg
      className={styles.postGlyphIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h10" />
    </svg>
  )
}

function HeroPhoto(props: {
  src: string | undefined
  loading: boolean
  isPost: boolean
  letter: string
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
    >
      {props.isPost ? <PostGlyph /> : props.loading ? null : props.letter || '?'}
    </div>
  )
}

interface DisplayChrome {
  displayName?: string
  handle?: string
  bannerPath?: string
  headline?: string
  authorHandle?: string
  authorTwitterId?: string
  role?: XPostRole
}

export default function SubjectHeader(props: {
  subject: SerializableTrustSubject
}) {
  const { subject } = props
  const kind = subjectHeaderKind(subject.value)
  const [loadedSubject, setLoadedSubject] = useState(subject.value)
  const [loading, setLoading] = useState(kind !== 'unknown')
  const [display, setDisplay] = useState<DisplayChrome>({})
  const loadGen = useRef(0)

  if (subject.value !== loadedSubject) {
    setLoadedSubject(subject.value)
    setDisplay({})
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
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      switch (parsed.type) {
        case 'account': {
          const identity = await loadIdentityRow(parsed.twitterId)
          if (!stillCurrent()) return
          const handle = identity ? identityHandle(identity) : undefined
          setDisplay(
            identity
              ? {
                  ...(identity.displayName
                    ? { displayName: identity.displayName }
                    : {}),
                  ...(handle ? { handle } : {}),
                  ...(identity.bannerPath
                    ? { bannerPath: identity.bannerPath }
                    : {}),
                }
              : {},
          )
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
          const authorTwitterId = postDisplay?.authorTwitterId?.trim()
          let bannerPath: string | undefined
          if (authorTwitterId) {
            try {
              const identity = await loadIdentityRow(authorTwitterId)
              if (!stillCurrent()) return
              bannerPath = identity?.bannerPath?.trim() || undefined
            } catch {
              if (!stillCurrent()) return
            }
          }
          setDisplay(
            postDisplay
              ? {
                  ...(postDisplay.headline
                    ? { headline: postDisplay.headline }
                    : {}),
                  ...(postDisplay.authorHandle
                    ? { authorHandle: postDisplay.authorHandle }
                    : {}),
                  ...(postDisplay.role ? { role: postDisplay.role } : {}),
                  ...(authorTwitterId ? { authorTwitterId } : {}),
                  ...(bannerPath ? { bannerPath } : {}),
                }
              : {},
          )
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
    if (!twitterId) return
    const onMessage = (message: XIdentityUpdatedMessage | { type?: string }) => {
      if (message?.type !== 'X_IDENTITY_UPDATED') return
      if (!('twitterId' in message) || message.twitterId !== twitterId) return
      void loadChrome()
    }
    chrome.runtime.onMessage.addListener(onMessage)
    return () => chrome.runtime.onMessage.removeListener(onMessage)
  }, [display.authorTwitterId, loadChrome, subject.value])

  const userNoun = t('panel.subjectHeader.user')
  const postNoun = t('panel.subjectHeader.post')
  const unknownNoun = t('panel.subjectHeader.unknown')
  const parsed = parseCanonicalTwitterSubject(subject.value)

  let title = unknownNoun
  let subtitle = ''
  switch (kind) {
    case 'account': {
      if (loading || parsed?.type !== 'account') {
        title = userNoun
        break
      }
      const lines = formatUserSubjectHeader({
        twitterId: parsed.twitterId,
        displayName: display.displayName,
        handle: display.handle,
        userNoun,
      })
      title = lines.title
      subtitle = lines.subtitle
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
        authorHandle: display.authorHandle,
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
      break
    }
    case 'unknown':
      title = unknownNoun
      break
    default: {
      const _exhaustive: never = kind
      void _exhaustive
      title = unknownNoun
    }
  }

  const picture = loading ? undefined : subjectHeroPictureUrl(display.bannerPath)
  const isPost = kind === 'post'
  const letter = avatarFallbackLetter(title)
  const ariaLabel = loading
    ? t('panel.subjectHeader.loading')
    : subtitle
      ? `${title}, ${subtitle}`
      : title

  return (
    <header
      className={styles.root}
      aria-label={ariaLabel}
      aria-busy={loading}
    >
      <div className={styles.hero}>
        <HeroPhoto
          key={picture ?? subject.value}
          src={picture}
          loading={loading}
          isPost={isPost}
          letter={letter}
        />
      </div>
      <div className={styles.text}>
        <h2 className={styles.title} title={title}>
          {title}
        </h2>
        {loading ? (
          <span className={`${styles.subtitleSkeleton} ${styles.pulse}`} />
        ) : subtitle ? (
          <p className={styles.subtitle} title={subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>
    </header>
  )
}
