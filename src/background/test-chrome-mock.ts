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
    onChanged: { addListener() {} },
  },
  alarms: {
    create: async () => undefined,
    get: async () => undefined,
    clear: async () => undefined,
    onAlarm: { addListener() {} },
  },
  tabs: {
    query: async () => [],
    get: async () => ({ id: 1, status: 'complete', url: 'https://x.com/home' }),
    create: async () => ({ id: 1, status: 'complete', url: 'https://x.com/home' }),
    update: async () => ({ id: 1, status: 'complete' }),
    reload: async () => undefined,
    sendMessage: async () => ({}),
    onUpdated: { addListener() {}, removeListener() {} },
    captureVisibleTab: async () => '',
  },
  action: {
    setBadgeText: async () => undefined,
    setBadgeBackgroundColor: async () => undefined,
    getBadgeText: async () => '',
    setTitle: async () => undefined,
  },
}

;(globalThis as { chrome?: unknown }).chrome = chromeMock

export function resetChromeStorage(): void {
  for (const key of Object.keys(local._data)) delete local._data[key]
  for (const key of Object.keys(sync._data)) delete sync._data[key]
  for (const key of Object.keys(session._data)) delete session._data[key]
}
