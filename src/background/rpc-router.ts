/**
 * Nostr-wot-style RPC router (vault, accounts, NIP-07, onboarding).
 * Wallet/WebLN handlers intentionally omitted.
 */

import browser from '../vault/browser.ts'
import * as vault from '../vault/vault.ts'
import { randomHex } from '../vault/crypto/utils.ts'
import {
  config,
  npubToHex,
  buildPrivilegedMethods,
  setPrivilegedMethods,
  PRIVILEGED_METHODS,
  type HandlerFn,
} from '../lib/nostr/nip07/bg/state.ts'
import { handlers as miscHandlers } from '../lib/nostr/nip07/bg/misc-handlers.ts'
import { handlers as vaultHandlers } from '../vault/bg/vault-handlers.ts'
import { handlers as onboardingHandlers } from '../accounts/bg/onboarding-handlers.ts'
import { mergeRoamingSyncIntoLocal } from '../vault/roaming-merge.ts'
import { syncActivePubkey } from '../vault/bg/vault-handlers.ts'
import { writeLocalAccounts } from '../accounts/local-account-mirror.ts'

const allHandlers = new Map<string, HandlerFn>()
const handlerGroups = [
  miscHandlers,
  vaultHandlers,
  onboardingHandlers,
]

for (const group of handlerGroups) {
  for (const [method, fn] of group) {
    if (allHandlers.has(method)) {
      console.error(
        `[BG] Duplicate handler registration: "${method}" — later registration overwrites earlier one`,
      )
    }
    allHandlers.set(method, fn)
  }
}

allHandlers.set('configUpdated', async () => {
  await loadConfig()
  return { ok: true }
})

setPrivilegedMethods(buildPrivilegedMethods(...handlerGroups))
PRIVILEGED_METHODS.add('configUpdated')

async function loadConfig(): Promise<void> {
  const data = (await browser.storage.sync.get([
    'myPubkey',
    'relays',
  ])) as Record<string, unknown>

  config.myPubkey = (data.myPubkey as string) || null

  if (typeof data.relays === 'string') {
    config.relays = data.relays
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
  }

  const localData = (await browser.storage.local.get([
    'accounts',
    'activeAccountId',
  ])) as Record<string, unknown>
  let activeAccountId = localData.activeAccountId as string | undefined

  if (!activeAccountId && data.myPubkey) {
    let accts =
      (localData.accounts as Array<{
        id: string
        name: string
        pubkey: string
        type: string
        readOnly: boolean
      }>) || []
    if (accts.length === 0) {
      const id = Date.now().toString(36) + randomHex(6)
      accts = [
        {
          id,
          name: 'Default',
          pubkey: data.myPubkey as string,
          type: 'npub',
          readOnly: true,
        },
      ]
      activeAccountId = id
      await writeLocalAccounts({
        accounts: accts.map((account) => ({
          ...account,
          boundTwitterIds: [],
          boundTwitterId: null,
          boundUpdatedAt: null,
        })),
        activeAccountId: id,
        markPersisted: true,
      })
    } else {
      activeAccountId = accts[0].id
      await browser.storage.local.set({ activeAccountId })
    }
  }
}

export async function handleRpcRequest({
  method,
  params,
}: {
  method: string
  params: Record<string, unknown>
}): Promise<unknown> {
  if (method.startsWith('webln_') || method.startsWith('nip07_')) {
    throw new Error(
      method.startsWith('webln_')
        ? 'Payments are not supported in Attention'
        : 'Page signing is not supported in Attention',
    )
  }

  if (params?.pubkey) {
    params.pubkey = npubToHex(params.pubkey as string) || params.pubkey
  }
  if (Array.isArray(params?.pubkeys)) {
    params.pubkeys = (params.pubkeys as string[]).map(
      (t) => npubToHex(t) || t,
    )
  }

  const handler = allHandlers.get(method)
  if (!handler) {
    throw new Error(`Unknown method: ${method}`)
  }

  return await handler(params)
}

export function installRpcListeners(): void {
  browser.runtime.onMessage.addListener(
    (
      request: Record<string, unknown>,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ) => {
      const method = request?.method as string | undefined
      if (!method || typeof method !== 'string') {
        return false
      }

      if (PRIVILEGED_METHODS.has(method)) {
        const senderUrl = sender.url || sender.tab?.url || ''
        const isInternal =
          sender.id === browser.runtime.id &&
          (!sender.tab || senderUrl.startsWith(browser.runtime.getURL('')))
        if (!isInternal) {
          sendResponse({ error: 'Permission denied' })
          return true
        }
      }

      handleRpcRequest(
        request as { method: string; params: Record<string, unknown> },
      )
        .then((result) => {
          sendResponse({ result })
        })
        .catch((error: unknown) => {
          sendResponse({
            error:
              error instanceof Error
                ? error.message
                : (error as { name?: string }).name || 'Unknown error',
          })
        })
      return true
    },
  )

  if (browser.alarms?.onAlarm) {
    browser.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
      if (alarm.name === 'vault-keepalive') {
        void browser.storage.local.get('autoLockMs').catch(() => undefined)
      }
    })
  }
}

const RETIRED_SITE_SIGNER_KEYS = [
  'allowedDomains',
  'dismissedDomains',
  'weblnAllowedDomains',
  'identityDisabledSites',
  'signerPermissions',
  'signerUseGlobalDefaults',
  '_permMigrationVersion',
  'xHostOneTimeAutoConnectDone',
]

async function clearRetiredSiteSignerStorage(): Promise<void> {
  await browser.storage.local.remove(RETIRED_SITE_SIGNER_KEYS)
  await browser.storage.session.remove('signerPending')
}

export async function startVaultRuntime(): Promise<void> {
  await loadConfig()
  await clearRetiredSiteSignerStorage()

  try {
    await vault.restoreAutoLockSetting()
    const data = await browser.storage.local.get([
      'autoLockMs',
      'activeAccountId',
    ])
    if (
      ((data as Record<string, unknown>).autoLockMs ?? 900000) === 0 &&
      (await vault.exists())
    ) {
      const ok = await vault.unlock('')
      if (ok) {
        if ((data as Record<string, unknown>).activeAccountId) {
          try {
            await vault.setActiveAccount(
              (data as Record<string, unknown>).activeAccountId as string,
            )
          } catch {
            vault.clearActiveAccount()
          }
        }
      }
    }

    // X-bound roaming: restore / merge Sync when enabled
    try {
      await mergeRoamingSyncIntoLocal()
      if ((await vault.exists()) && !vault.isLocked()) {
        await syncActivePubkey()
      }
    } catch (e: unknown) {
      console.warn(
        '[ROAMING] Merge failed:',
        e instanceof Error ? e.message : e,
      )
    }
  } catch (e: unknown) {
    console.warn(
      '[VAULT] Auto-unlock failed:',
      e instanceof Error ? e.message : e,
    )
  }
}
