import {
  BACKGROUND_API_VERSION,
  STORAGE_KEY,
  type ExtensionRequest,
  type ExtensionResponse,
} from '../shared/contracts'
import { OUTBOX_HOLD_ALARM } from '../relay'
import { MAINTENANCE_ALARM } from '../shared/wot-sync-interval'
import { AttentionXRepository } from '../storage'
import { SimplePoolAdapter } from './adapters'
import {
  AttentionXBackend,
  parseSyncRelayList,
  type BackgroundSettingsStore,
} from './backend'
import { installRpcListeners, startVaultRuntime } from './rpc-router'
import { OPEN_NOTES_ON_LAUNCH_KEY } from '../shared/selected-subject'
import { getPanelSessionSnapshot, startPanelSessionController } from './panel-session-controller'

const settingsStore: BackgroundSettingsStore = {
  async read() {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    return result[STORAGE_KEY]
  },
  async write(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings })
  },
}

const backendPromise = AttentionXRepository.open().then((repository) =>
  AttentionXBackend.create({
    repository,
    settingsStore,
    relay: new SimplePoolAdapter(),
  }),
)

async function applyNetworkRelaysToBackend(
  rawRelays: unknown,
): Promise<void> {
  const relays = parseSyncRelayList(rawRelays)
  if (!relays || relays.length === 0) return
  const backend = await backendPromise
  await backend.handleRequest({ type: 'SAVE_RELAYS', relays })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.relays) return
  void applyNetworkRelaysToBackend(changes.relays.newValue).catch(
    (error: unknown) => {
      console.info('AttentionX relay sync deferred', error)
    },
  )
})

let maintenanceRun: Promise<void> | undefined
let alarmSetup: Promise<void> | undefined

async function runMaintenance(): Promise<void> {
  if (maintenanceRun) return maintenanceRun
  maintenanceRun = (async () => {
    const backend = await backendPromise
    await backend.runMaintenance()
  })()
  try {
    await maintenanceRun
  } finally {
    maintenanceRun = undefined
  }
}

async function ensureMaintenanceAlarm(): Promise<void> {
  if (alarmSetup) return alarmSetup
  alarmSetup = (async () => {
    // The backend owns the configured interval; it reconciles the alarm.
    const backend = await backendPromise
    await backend.reconcileMaintenanceAlarm()
  })()
  try {
    await alarmSetup
  } finally {
    alarmSetup = undefined
  }
}

function startAlarmSetup(): void {
  void ensureMaintenanceAlarm().catch((error: unknown) => {
    console.info('AttentionX alarm setup deferred', error)
  })
}

function startMaintenance(): void {
  void runMaintenance().catch((error: unknown) => {
    console.info('AttentionX maintenance deferred', error)
  })
}

function parseRequest(value: unknown): ExtensionRequest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    typeof value.type !== 'string'
  ) {
    throw new Error('Invalid AttentionX background request')
  }
  return value as ExtensionRequest
}

function isRpcEnvelope(value: unknown): value is {
  method: string
  params?: Record<string, unknown>
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'method' in value &&
    typeof (value as { method: unknown }).method === 'string'
  )
}

function isAttentionXEnvelope(value: unknown): value is ExtensionRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  )
}

chrome.runtime.onInstalled.addListener(() => {
  startAlarmSetup()
  startMaintenance()
})

chrome.runtime.onStartup.addListener(() => {
  startAlarmSetup()
  startMaintenance()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (
    alarm.name === MAINTENANCE_ALARM ||
    alarm.name === OUTBOX_HOLD_ALARM
  ) {
    startMaintenance()
  }
})

startAlarmSetup()
startMaintenance()
installRpcListeners()
startPanelSessionController()
void startVaultRuntime().catch((error: unknown) => {
  console.info('AttentionX vault runtime deferred', error)
})

// Toolbar icon opens the Chrome Side Panel (requires Chromium sidePanel API).
void chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  ?.catch((error: unknown) => {
    console.info('AttentionX side panel behavior deferred', error)
  })

chrome.runtime.onMessage.addListener(
  (request: unknown, sender, sendResponse) => {
    // Vault / NIP-07 RPC uses { method, params } — handled by rpc-router's listener.
    // Skip here so both protocols can coexist (rpc-router registers first and
    // returns true for method envelopes; Chrome delivers to all listeners).
    if (isRpcEnvelope(request)) {
      return false
    }

    if (sender.id !== chrome.runtime.id) {
      const response: ExtensionResponse<never> = {
        ok: false,
        version: BACKGROUND_API_VERSION,
        error: 'Rejected message from an untrusted extension origin',
      }
      sendResponse(response)
      return false
    }

    if (!isAttentionXEnvelope(request)) {
      return false
    }

    // `sidePanel.open` must run in this turn — any `await` (including
    // `backendPromise`) drops the user-gesture Chrome requires.
    // Extension pages (side panel / popup) already have the panel; opening
    // again is not a user-gesture for `sidePanel.open`.
    const fromExtensionPage = Boolean(
      sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`),
    )
    if (
      request.type === 'OPEN_SIDE_PANEL' &&
      typeof sender.tab?.id === 'number' &&
      !fromExtensionPage
    ) {
      void chrome.storage.session
        .set({ [OPEN_NOTES_ON_LAUNCH_KEY]: true })
        .catch(() => undefined)
      const sidePanel = (
        chrome as typeof chrome & {
          sidePanel?: { open?: (options: { tabId: number }) => Promise<void> }
        }
      ).sidePanel
      void sidePanel?.open?.({ tabId: sender.tab.id }).catch(() => undefined)
    }

    if (request.type === 'GET_PANEL_SESSION') {
      void getPanelSessionSnapshot()
        .then((data) => {
          const response: ExtensionResponse<unknown> = {
            ok: true,
            version: BACKGROUND_API_VERSION,
            data,
          }
          sendResponse(response)
        })
        .catch((error: unknown) => {
          const response: ExtensionResponse<never> = {
            ok: false,
            version: BACKGROUND_API_VERSION,
            error:
              error instanceof Error
                ? error.message
                : 'Unexpected AttentionX error',
          }
          sendResponse(response)
        })
      return true
    }

    void backendPromise
      .then((backend) =>
        backend.handleRequest(parseRequest(request), {
          senderTabId: sender.tab?.id,
          ...(typeof sender.tab?.windowId === 'number'
            ? { senderWindowId: sender.tab.windowId }
            : {}),
          ...(sender.url ? { senderUrl: sender.url } : {}),
        }),
      )
      .then((data) => {
        const response: ExtensionResponse<unknown> = {
          ok: true,
          version: BACKGROUND_API_VERSION,
          data,
        }
        sendResponse(response)
      })
      .catch((error: unknown) => {
        const response: ExtensionResponse<never> = {
          ok: false,
          version: BACKGROUND_API_VERSION,
          error:
            error instanceof Error
              ? error.message
              : 'Unexpected AttentionX error',
        }
        sendResponse(response)
      })

    return true
  },
)
