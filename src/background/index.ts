import {
  BACKGROUND_API_VERSION,
  STORAGE_KEY,
  type ExtensionRequest,
  type ExtensionResponse,
} from '../shared/contracts'
import { AttentionXRepository } from '../storage'
import { SimplePoolAdapter } from './adapters'
import {
  AttentionXBackend,
  parseSyncRelayList,
  type BackgroundSettingsStore,
} from './backend'
import { installRpcListeners, startVaultRuntime } from './rpc-router'

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

const MAINTENANCE_ALARM = 'attentionx-maintenance'
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
    if (await chrome.alarms.get(MAINTENANCE_ALARM)) return
    await chrome.alarms.create(MAINTENANCE_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 15,
    })
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
  if (alarm.name === MAINTENANCE_ALARM) {
    startMaintenance()
  }
})

startAlarmSetup()
startMaintenance()
installRpcListeners()
void startVaultRuntime().catch((error: unknown) => {
  console.info('AttentionX vault runtime deferred', error)
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

    void backendPromise
      .then((backend) =>
        backend.handleRequest(parseRequest(request), {
          senderTabId: sender.tab?.id,
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
