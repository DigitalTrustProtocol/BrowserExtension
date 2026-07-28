export const X_PROFILE_IMAGE_ORIGIN = 'https://pbs.twimg.com/'

const PROFILE_IMAGE_PATH_PATTERN =
  /^profile_images\/\d{1,24}\/[\w-]+$/i

const PROFILE_IMAGE_URL_PATTERN =
  /^https?:\/\/pbs\.twimg\.com\/profile_images\/(\d{1,24})\/([\w-]+?)(?:_(?:normal|bigger|mini|400x400|200x200))?\.(?:jpe?g|png|webp)?$/i

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
