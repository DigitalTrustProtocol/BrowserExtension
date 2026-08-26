export const X_PROFILE_IMAGE_ORIGIN = 'https://pbs.twimg.com/'

const PROFILE_IMAGE_PATH_PATTERN =
  /^profile_images\/\d{1,24}\/[\w-]+$/i

const PROFILE_ICON_SIZES = [
  'normal',
  'bigger',
  'mini',
  '400x400',
  '200x200',
] as const

const PROFILE_ICON_SIZE_PATTERN = PROFILE_ICON_SIZES.join('|')

const STORED_ICON_URL_PATTERN = new RegExp(
  `^https://pbs\\.twimg\\.com/profile_images/(\\d{1,24})/([\\w-]+)_(${PROFILE_ICON_SIZE_PATTERN})\\.(jpe?g|png|webp)$`,
  'i',
)

const PROFILE_ICON_FILE_PATTERN = new RegExp(
  `^([\\w-]+?)(?:_(${PROFILE_ICON_SIZE_PATTERN}))?(?:\\.(jpe?g|png|webp))?$`,
  'i',
)

const PROFILE_BANNER_PATH_PATTERN =
  /^profile_banners\/\d{1,24}\/\d{1,16}$/

const PROFILE_BANNER_URL_PATTERN =
  /^https?:\/\/pbs\.twimg\.com\/profile_banners\/(\d{1,24})\/(\d{1,16})(?:\/(?:\d{2,5}x\d{2,5}|web(?:_retina|_photo)?|ipad(?:_retina)?|mobile(?:_retina)?))?(?:\.(?:jpe?g|png|webp))?$/i

const MAX_PROFILE_ICON_INPUT_LENGTH = 2_048

export type XProfileBannerSize = '1500x500' | '1080x360' | '600x200' | '300x100'

export type XProfileIconSize = 'normal' | '200x200' | '400x400'

type StoredProfileIconSize = (typeof PROFILE_ICON_SIZES)[number]

type ProfileIconExt = 'jpg' | 'png' | 'webp'

interface ParsedProfileIcon {
  id: string
  hash: string
  size: StoredProfileIconSize
  ext?: ProfileIconExt
}

export const MAX_X_DISPLAY_NAME_LENGTH = 80

export function normalizeXDisplayName(value: string): string | undefined {
  const trimmed = value.trim().slice(0, MAX_X_DISPLAY_NAME_LENGTH)
  return trimmed.length > 0 ? trimmed : undefined
}

function isLegacyIconStem(value: string): boolean {
  return PROFILE_IMAGE_PATH_PATTERN.test(value)
}

function isStoredIconUrl(value: string): boolean {
  return STORED_ICON_URL_PATTERN.test(value)
}

function normalizeIconExt(value: string | undefined): ProfileIconExt | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower === 'jpg' || lower === 'jpeg') return 'jpg'
  if (lower === 'png') return 'png'
  if (lower === 'webp') return 'webp'
  return undefined
}

function normalizeIconSize(
  value: string | undefined,
): StoredProfileIconSize | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  for (const size of PROFILE_ICON_SIZES) {
    if (size === lower) return size
  }
  return undefined
}

function canonicalIconUrl(parsed: ParsedProfileIcon & { ext: ProfileIconExt }): string {
  return `${X_PROFILE_IMAGE_ORIGIN}profile_images/${parsed.id}/${parsed.hash}_${parsed.size}.${parsed.ext}`
}

function parseProfileIconUrl(raw: string): ParsedProfileIcon | undefined {
  const trimmed = raw.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_PROFILE_ICON_INPUT_LENGTH
  ) {
    return undefined
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.hostname.toLowerCase() !== 'pbs.twimg.com') return undefined
  if (url.username || url.password || url.port) return undefined

  const pathMatch = /^\/profile_images\/(\d{1,24})\/([^/]+)$/.exec(
    url.pathname,
  )
  if (!pathMatch?.[1] || !pathMatch[2]) return undefined

  let filename: string
  try {
    filename = decodeURIComponent(pathMatch[2])
  } catch {
    return undefined
  }

  const fileMatch = PROFILE_ICON_FILE_PATTERN.exec(filename)
  if (!fileMatch?.[1]) return undefined

  const hash = fileMatch[1]
  const stem = `profile_images/${pathMatch[1]}/${hash}`
  if (!PROFILE_IMAGE_PATH_PATTERN.test(stem)) return undefined

  const queryExt = normalizeIconExt(url.searchParams.get('format') ?? undefined)
  const querySize = normalizeIconSize(url.searchParams.get('name') ?? undefined)
  const ext =
    normalizeIconExt(fileMatch[3]) ?? queryExt
  const size =
    normalizeIconSize(fileMatch[2]) ?? querySize ?? 'normal'

  return {
    id: pathMatch[1],
    hash,
    size,
    ...(ext ? { ext } : {}),
  }
}

/**
 * Persist a canonical HTTPS pbs.twimg.com avatar URL (size + extension)
 * when the source URL includes a format. Legacy path stems pass through.
 */
export function normalizeXProfileIconPath(url: string): string | undefined {
  const trimmed = url.trim()
  if (isLegacyIconStem(trimmed)) return trimmed
  const parsed = parseProfileIconUrl(trimmed)
  if (!parsed) return undefined
  if (parsed.ext) return canonicalIconUrl({ ...parsed, ext: parsed.ext })
  const stem = `profile_images/${parsed.id}/${parsed.hash}`
  return PROFILE_IMAGE_PATH_PATTERN.test(stem) ? stem : undefined
}

export function buildXProfileIconUrl(
  iconPath: string,
  size: XProfileIconSize = '200x200',
): string {
  if (isLegacyIconStem(iconPath)) {
    return `${X_PROFILE_IMAGE_ORIGIN}${iconPath}_${size}.jpg`
  }
  const parsed = parseProfileIconUrl(iconPath)
  if (parsed?.ext) {
    return canonicalIconUrl({ ...parsed, size, ext: parsed.ext })
  }
  return `${X_PROFILE_IMAGE_ORIGIN}${iconPath}_${size}.jpg`
}

/** True for a legacy stem or a canonical stored HTTPS avatar URL. */
export function isXProfileIconPath(value: string): boolean {
  return isLegacyIconStem(value) || isStoredIconUrl(value)
}

/**
 * Prefer a stored full avatar URL over a legacy stem so a later stem-only
 * observation cannot strip PNG/WebP format.
 */
export function preferXProfileIconChrome(
  next: string | undefined,
  previous: string | undefined,
): string | undefined {
  if (!next) return previous
  if (!previous) return next
  if (isLegacyIconStem(next) && isStoredIconUrl(previous)) return previous
  return next
}

/** Store only the pbs.twimg.com banner stem (no size suffix). */
export function normalizeXProfileBannerPath(url: string): string | undefined {
  const trimmed = url.trim()
  if (PROFILE_BANNER_PATH_PATTERN.test(trimmed)) return trimmed
  const match = trimmed.match(PROFILE_BANNER_URL_PATTERN)
  if (!match?.[1] || !match?.[2]) return undefined
  const path = `profile_banners/${match[1]}/${match[2]}`
  return PROFILE_BANNER_PATH_PATTERN.test(path) ? path : undefined
}

export function buildXProfileBannerUrl(
  bannerPath: string,
  size: XProfileBannerSize = '1500x500',
): string {
  return `${X_PROFILE_IMAGE_ORIGIN}${bannerPath}/${size}`
}

export function isXProfileBannerPath(value: string): boolean {
  return PROFILE_BANNER_PATH_PATTERN.test(value)
}
