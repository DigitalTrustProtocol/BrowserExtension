export const X_PROFILE_IMAGE_ORIGIN = 'https://pbs.twimg.com/'

const PROFILE_IMAGE_PATH_PATTERN =
  /^profile_images\/\d{1,24}\/[\w-]+$/i

const PROFILE_IMAGE_URL_PATTERN =
  /^https?:\/\/pbs\.twimg\.com\/profile_images\/(\d{1,24})\/([\w-]+?)(?:_(?:normal|bigger|mini|400x400|200x200))?\.(?:jpe?g|png|webp)?$/i

const PROFILE_BANNER_PATH_PATTERN =
  /^profile_banners\/\d{1,24}\/\d{1,16}$/

const PROFILE_BANNER_URL_PATTERN =
  /^https?:\/\/pbs\.twimg\.com\/profile_banners\/(\d{1,24})\/(\d{1,16})(?:\/(?:\d{2,5}x\d{2,5}|web(?:_retina|_photo)?|ipad(?:_retina)?|mobile(?:_retina)?))?(?:\.(?:jpe?g|png|webp))?$/i

export type XProfileBannerSize = '1500x500' | '1080x360' | '600x200' | '300x100'

export const MAX_X_DISPLAY_NAME_LENGTH = 80

export function normalizeXDisplayName(value: string): string | undefined {
  const trimmed = value.trim().slice(0, MAX_X_DISPLAY_NAME_LENGTH)
  return trimmed.length > 0 ? trimmed : undefined
}

/** Store only the pbs.twimg.com path stem (no size suffix or extension). */
export function normalizeXProfileIconPath(url: string): string | undefined {
  const trimmed = url.trim()
  const match = trimmed.match(PROFILE_IMAGE_URL_PATTERN)
  if (!match?.[1] || !match?.[2]) return undefined
  // Keep filename case — pbs.twimg.com paths are case-sensitive.
  const path = `profile_images/${match[1]}/${match[2]}`
  return PROFILE_IMAGE_PATH_PATTERN.test(path) ? path : undefined
}

export function buildXProfileIconUrl(
  iconPath: string,
  size: 'normal' | '200x200' | '400x400' = '200x200',
): string {
  return `${X_PROFILE_IMAGE_ORIGIN}${iconPath}_${size}.jpg`
}

export function isXProfileIconPath(value: string): boolean {
  return PROFILE_IMAGE_PATH_PATTERN.test(value)
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
