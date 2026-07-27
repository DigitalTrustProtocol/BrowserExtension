/** Which on-page UI the x.com content script renders. Shared with the popup. */
export const X_AUGMENTATION_STYLE_KEY = 'xAugmentationStyle'

export const X_AUGMENTATION_STYLES = [
  'chip',
  'ambient',
  'hoverbar',
  'combined',
  'panel',
  'off',
] as const

export type XAugmentationStyle = (typeof X_AUGMENTATION_STYLES)[number]

export const DEFAULT_X_AUGMENTATION_STYLE: XAugmentationStyle = 'combined'

export function isXAugmentationStyle(
  value: unknown,
): value is XAugmentationStyle {
  return (
    typeof value === 'string' &&
    (X_AUGMENTATION_STYLES as readonly string[]).includes(value)
  )
}
