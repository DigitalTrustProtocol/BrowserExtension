import { openSidePanel } from '../open-side-panel'
import { hasWritableOperatorKey } from '../operator-key'
import { trustDescriptor } from '../trust-helpers'
import type { Target } from '../types'
import { openRatingPopover } from './rating-popover'
import { openTrustDialog, type TrustDialogOptions } from './trust-dialog'

function openPanelForTarget(target: Target): void {
  const descriptor = trustDescriptor(target)
  if (!descriptor) return
  void openSidePanel({
    subject: descriptor.subject,
    context: descriptor.context,
  }).catch(() => {
    /* Notes surface failures after the panel opens. */
  })
}

/** Author chip / hovercard / profile: panel when there is no writable key. */
export function openAuthorTrustOrPanel(
  options: TrustDialogOptions,
): void {
  if (!hasWritableOperatorKey()) {
    openPanelForTarget(options.target)
    return
  }
  openTrustDialog(options)
}

/** Post star: panel when there is no writable key. */
export function openPostRatingOrPanel(options: {
  target: Target
  anchor: HTMLElement
  title?: string
  onCommitted?: () => void
}): void {
  if (!hasWritableOperatorKey()) {
    openPanelForTarget(options.target)
    return
  }
  openRatingPopover({
    target: options.target,
    anchor: options.anchor,
    ...(options.title ? { title: options.title } : {}),
    ...(options.onCommitted ? { onCommitted: options.onCommitted } : {}),
  })
}
