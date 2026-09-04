/**
 * Gesture-safe side-panel open. `chrome.sidePanel.open` must run in the same
 * turn as the click message — any `await` drops the user gesture.
 * Swallow Chrome's rejection so a missing gesture never surfaces as uncaught.
 *
 * @module background/open-side-panel-gesture
 */

import {
  OPEN_NOTES_ON_LAUNCH_KEY,
  SELECTED_SUBJECT_STORAGE_KEY,
  isSelectedSubject,
  type SelectedSubject,
} from '../shared/selected-subject.ts'

export function parseSelectedSubjectFromOpenRequest(
  request: unknown,
): SelectedSubject | undefined {
  if (!request || typeof request !== 'object') return undefined
  const rec = request as { type?: unknown; subject?: unknown; context?: unknown }
  if (rec.type !== 'OPEN_SIDE_PANEL') return undefined
  const selected = {
    subject: rec.subject,
    ...(typeof rec.context === 'string' && rec.context
      ? { context: rec.context }
      : {}),
  }
  return isSelectedSubject(selected) ? selected : undefined
}

/**
 * Persist Notes intent and open the panel without awaiting. Callers must invoke
 * this synchronously in the message handler.
 */
export function openSidePanelFromUserGesture(input: {
  tabId: number
  selected?: SelectedSubject
}): void {
  const payload: Record<string, unknown> = {
    [OPEN_NOTES_ON_LAUNCH_KEY]: true,
  }
  if (input.selected) {
    payload[SELECTED_SUBJECT_STORAGE_KEY] = input.selected
  }
  void chrome.storage.session.set(payload).catch(() => undefined)
  const sidePanel = (
    chrome as typeof chrome & {
      sidePanel?: { open?: (options: { tabId: number }) => Promise<void> }
    }
  ).sidePanel
  void sidePanel?.open?.({ tabId: input.tabId })?.catch(() => undefined)
}
