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
  type BackgroundSettingsStore,
} from './backend'

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

chrome.runtime.onMessage.addListener(
  (request: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      const response: ExtensionResponse<never> = {
        ok: false,
        version: BACKGROUND_API_VERSION,
        error: 'Rejected message from an untrusted extension origin',
      }
      sendResponse(response)
      return false
    }

    void backendPromise
      .then((backend) => backend.handleRequest(parseRequest(request)))
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
          error: error instanceof Error ? error.message : 'Unexpected AttentionX error',
        }
        sendResponse(response)
      })

    return true
  },
)
