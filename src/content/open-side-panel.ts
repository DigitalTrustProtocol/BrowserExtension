import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type SerializableTrustSubject,
} from '../shared/contracts'

/** Open the Chrome Side Panel Notes view bound to a subject. */
export async function openSidePanel(input: {
  subject: SerializableTrustSubject
  context?: string
}): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'OPEN_SIDE_PANEL',
    version: BACKGROUND_API_VERSION,
    subject: input.subject,
    ...(input.context !== undefined ? { context: input.context } : {}),
  })) as ExtensionResponse<{ opened: boolean; subject: SerializableTrustSubject }>
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Could not open the Side Panel')
  }
}
