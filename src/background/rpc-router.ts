/**
 * Nostr-wot-style RPC router (vault, accounts, NIP-07, onboarding).
 * Wallet/WebLN handlers intentionally omitted.
 */

import browser from '../vault/browser.ts'
import * as vault from '../vault/vault.ts'
import * as signer from '../nip07/signer.ts'
import * as signerPermissions from '../nip07/permissions.ts'
import { openPopupForActiveTab } from '../nip07/openPopupForActiveTab.ts'
import { randomHex } from '../vault/crypto/utils.ts'
import {
  config,
  NIP07_SIGNING_METHODS,
  npubToHex,
  buildPrivilegedMethods,
  setPrivilegedMethods,
  PRIVILEGED_METHODS,
  type HandlerFn,
} from '../nip07/bg/state.ts'
import { handlers as miscHandlers, logActivity } from '../nip07/bg/misc-handlers.ts'
import {
  handlers as domainHandlers,
  isDomainAllowed,
  isDomainDismissed,
  waitForDomainAllowed,
  isActiveAccountReadOnly,
  maybeOneTimeAutoConnectXHost,
} from '../nip07/bg/domain-handlers.ts'
import { handlers as vaultHandlers } from '../vault/bg/vault-handlers.ts'
import {
  handlers as nip07Handlers,
  validateNip07Params,
} from '../nip07/bg/nip07-handlers.ts'
import { handlers as onboardingHandlers } from '../accounts/bg/onboarding-handlers.ts'

const allHandlers = new Map<string, HandlerFn>()
const handlerGroups = [
  miscHandlers,
  domainHandlers,
  vaultHandlers,
  nip07Handlers,
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

  if (data.relays) {
    config.relays = (data.relays as string)
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
      await browser.storage.local.set({ accounts: accts, activeAccountId: id })
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
  if (method.startsWith('webln_')) {
    throw new Error('Payments are not supported in AttentionX')
  }

  if (method.startsWith('nip07_')) {
    validateNip07Params(method, params)
    const origin = params?.origin as string
    if (!origin) {
      logActivity({
        domain: 'unknown',
        method: method.replace('nip07_', ''),
        decision: 'blocked',
      })
      throw new Error('Site not connected')
    }
    if (!(await isDomainAllowed(origin))) {
      // One-time silent allow for x.com / twitter.com on first sight.
      if (await maybeOneTimeAutoConnectXHost(origin)) {
        // Connected — continue into the handler.
      } else if (await isDomainDismissed(origin)) {
        logActivity({
          domain: origin,
          method: method.replace('nip07_', ''),
          decision: 'blocked',
        })
        throw new Error('Site not connected')
      } else {
        await openPopupForActiveTab(origin)
        const connected = await waitForDomainAllowed(origin)
        if (!connected) {
          logActivity({
            domain: origin,
            method: method.replace('nip07_', ''),
            decision: 'blocked',
          })
          throw new Error('Site not connected')
        }
      }
    }
  }

  if (NIP07_SIGNING_METHODS.has(method) && (await isActiveAccountReadOnly())) {
    logActivity({
      domain: params?.origin as string,
      method: method.replace('nip07_', ''),
      decision: 'blocked',
    })
    throw new Error('Signing not available for read-only accounts')
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

      if (method.startsWith('nip07_')) {
        const originUrl =
          sender.frameId === 0
            ? sender.tab?.url
            : sender.url || sender.tab?.url
        if (!originUrl) {
          sendResponse({ error: 'Cannot determine request origin' })
          return true
        }
        ;(request.params as Record<string, unknown>).origin = new URL(
          originUrl,
        ).hostname
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

  browser.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name !== 'nip07') return

    port.onMessage.addListener(async (request: Record<string, unknown>) => {
      const method = request.method as string
      if (!method?.startsWith('nip07_')) {
        try {
          port.postMessage({ error: 'Permission denied' })
        } catch {
          /* ignore */
        }
        return
      }

      const originUrl =
        port.sender?.frameId === 0
          ? port.sender?.tab?.url
          : port.sender?.url || port.sender?.tab?.url
      if (!originUrl) {
        try {
          port.postMessage({ error: 'Cannot determine request origin' })
        } catch {
          /* ignore */
        }
        return
      }
      ;(request.params as Record<string, unknown>).origin = new URL(
        originUrl,
      ).hostname

      try {
        const result = await handleRpcRequest(
          request as { method: string; params: Record<string, unknown> },
        )
        try {
          port.postMessage({ result })
        } catch {
          /* ignore */
        }
      } catch (error) {
        try {
          port.postMessage({
            error:
              error instanceof Error ? error.message : 'Unknown error',
          })
        } catch {
          /* ignore */
        }
      }
    })
  })

  if (browser.alarms?.onAlarm) {
    browser.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
      if (alarm.name === 'vault-keepalive') {
        void browser.storage.local.get('autoLockMs').catch(() => undefined)
      }
    })
  }
}

export async function startVaultRuntime(): Promise<void> {
  await loadConfig()
  await signer.cleanupStale()

  try {
    const data = await browser.storage.local.get('_permMigrationVersion')
    if (
      (data as Record<string, unknown>)._permMigrationVersion !== 4
    ) {
      await signerPermissions.migrateToPerKind()
      await signerPermissions.migrateToPerAccount()
      await signerPermissions.migrateForwardToAsk()
      await signerPermissions.migrateDmKindsToSendMessages()
      await browser.storage.local.set({ _permMigrationVersion: 4 })
    }
  } catch (e: unknown) {
    console.warn(
      '[PERMISSIONS] Migration failed:',
      e instanceof Error ? e.message : e,
    )
  }

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
        await signer.onVaultUnlocked()
      }
    }
  } catch (e: unknown) {
    console.warn(
      '[VAULT] Auto-unlock failed:',
      e instanceof Error ? e.message : e,
    )
  }
}
