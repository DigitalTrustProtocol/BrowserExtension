import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
  type SerializableTrustSubject,
} from '../shared/contracts'

export interface PostPanelChrome {
  headline?: string
  authorTwitterId?: string
  authorHandle?: string
}

/** Headline and author already on the article, for a Notes open. */
export function postPanelChrome(
  target: { twitterId?: string; handle?: string },
  headline?: string,
): PostPanelChrome | undefined {
  const chrome: PostPanelChrome = {
    ...(headline ? { headline } : {}),
    ...(target.twitterId ? { authorTwitterId: target.twitterId } : {}),
    ...(target.handle ? { authorHandle: target.handle } : {}),
  }
  if (!chrome.headline && !chrome.authorTwitterId && !chrome.authorHandle) {
    return undefined
  }
  return chrome
}

/** Open the Chrome Side Panel Notes view bound to a subject. */
export async function openSidePanel(input: {
  subject: SerializableTrustSubject
  context?: string
  postChrome?: PostPanelChrome
}): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'OPEN_SIDE_PANEL',
    version: BACKGROUND_API_VERSION,
    subject: input.subject,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.postChrome ? { postChrome: input.postChrome } : {}),
  })) as ExtensionResponse<{ opened: boolean; subject: SerializableTrustSubject }>
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Could not open the Side Panel')
  }
}
