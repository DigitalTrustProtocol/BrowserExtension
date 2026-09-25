type StorageArea = {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
  remove: (keys: string | string[]) => Promise<void>
  _data: Record<string, unknown>
}

function createMemoryArea(): StorageArea {
  const data: Record<string, unknown> = {}
  return {
    _data: data,
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...data }
      const list = typeof keys === 'string' ? [keys] : keys
      const out: Record<string, unknown> = {}
      for (const key of list) {
        if (key in data) out[key] = data[key]
      }
      return out
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, items)
    },
    async remove(keys: string | string[]) {
      const list = typeof keys === 'string' ? [keys] : keys
      for (const key of list) delete data[key]
    },
  }
}

const local = createMemoryArea()
const sync = createMemoryArea()
const session = createMemoryArea()

type TabRemoveInfo = {
  windowId: number
  isWindowClosing: boolean
}

type TabRemovedListener = (
  tabId: number,
  removeInfo: TabRemoveInfo,
) => void

const tabRemovedListeners = new Set<TabRemovedListener>()

const DEFAULT_QUERY_TABS: Array<{
  id: number
  windowId: number
  url: string
  active: boolean
  status: string
}> = [
  {
    id: 1,
    windowId: 1,
    url: 'https://x.com/home',
    active: true,
    status: 'complete',
  },
]

let queriedTabs = [...DEFAULT_QUERY_TABS]

const chromeMock = {
  runtime: {
    id: 'attentionx-test',
    getURL: (path: string) => `chrome-extension://attentionx-test/${path}`,
    sendMessage: async () => undefined,
    onMessage: { addListener() {}, removeListener() {} },
    onConnect: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
  },
  storage: {
    local,
    sync,
    session,
    onChanged: { addListener() {}, removeListener() {} },
  },
  alarms: {
    create: async () => undefined,
    get: async () => undefined,
    clear: async () => undefined,
    onAlarm: { addListener() {} },
  },
  tabs: {
    query: async (queryInfo?: { active?: boolean }) => {
      const tabs =
        queryInfo?.active === true
          ? queriedTabs.filter((tab) => tab.active)
          : queriedTabs
      return tabs.map((tab) => ({ ...tab }))
    },
    get: async (tabId: number) => {
      const tab = queriedTabs.find((candidate) => candidate.id === tabId)
      if (!tab) throw new Error(`No tab with id: ${tabId}`)
      return { ...tab }
    },
    create: async () => ({ id: 2, status: 'complete', url: 'https://x.com/home' }),
    update: async () => ({ id: 1, status: 'complete' }),
    remove: async () => undefined,
    reload: async () => undefined,
    sendMessage: async () => ({}),
    onUpdated: { addListener() {}, removeListener() {} },
    onActivated: { addListener() {}, removeListener() {} },
    onRemoved: {
      addListener(listener: TabRemovedListener) {
        tabRemovedListeners.add(listener)
      },
      removeListener(listener: TabRemovedListener) {
        tabRemovedListeners.delete(listener)
      },
    },
    captureVisibleTab: async () => '',
  },
  action: {
    setBadgeText: async () => undefined,
    setBadgeBackgroundColor: async () => undefined,
    getBadgeText: async () => '',
    setTitle: async () => undefined,
  },
  sidePanel: {
    setPanelBehavior: async () => undefined,
    setOptions: async () => undefined,
    open: async () => undefined,
  },
  windows: {
    WINDOW_ID_NONE: -1,
    onFocusChanged: { addListener() {}, removeListener() {} },
  },
}

;(globalThis as { chrome?: unknown }).chrome = chromeMock

export function setChromeQueriedTabs(
  tabs: Array<{
    id: number
    windowId: number
    url: string
    active?: boolean
  }>,
): void {
  queriedTabs = tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    active: tab.active !== false,
    status: 'complete',
  }))
}

export function resetChromeStorage(): void {
  for (const key of Object.keys(local._data)) delete local._data[key]
  for (const key of Object.keys(sync._data)) delete sync._data[key]
  for (const key of Object.keys(session._data)) delete session._data[key]
  tabRemovedListeners.clear()
  queriedTabs = [...DEFAULT_QUERY_TABS]
}

/** Fire registered `chrome.tabs.onRemoved` listeners (test helper). */
export function emitTabRemoved(
  tabId: number,
  removeInfo: TabRemoveInfo = {
    windowId: 1,
    isWindowClosing: false,
  },
): void {
  for (const listener of [...tabRemovedListeners]) {
    listener(tabId, removeInfo)
  }
}
