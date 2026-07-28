import {
  BACKGROUND_API_VERSION,
  type ExtensionResponse,
} from '../shared/contracts'
import {
  buildGraphPageUrl,
  type BuildGraphPageUrlOptions,
} from '../shared/graph-deeplink'

/** Open the Extension Application Graph page in a new tab via the service worker. */
export async function openGraphPage(
  options: BuildGraphPageUrlOptions = {},
): Promise<void> {
  const url = buildGraphPageUrl(options) || '?'
  const response = (await chrome.runtime.sendMessage({
    type: 'OPEN_GRAPH_PAGE',
    version: BACKGROUND_API_VERSION,
    url,
  })) as ExtensionResponse<{ opened: true }>
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Could not open Graph page')
  }
}
