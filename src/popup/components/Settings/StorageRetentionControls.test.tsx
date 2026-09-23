/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  BACKGROUND_API_VERSION,
  type StorageRetentionState,
} from '../../../shared/contracts'
import type { StorageRetentionSettings } from '../../../shared/storage-retention'

vi.mock('@lib/i18n.js', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

const cssProxy = new Proxy({}, { get: (_target, prop) => String(prop) })
vi.mock('./Settings.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Input/Input.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Button/Button.module.css', () => ({ default: cssProxy }))
vi.mock('@components/Toggle/Toggle.module.css', () => ({ default: cssProxy }))
vi.mock('@components/SectionLabel/SectionLabel.module.css', () => ({
  default: cssProxy,
}))

const MB = 1024 * 1024

function retentionState(
  overrides: Partial<StorageRetentionState['stats']> = {},
  settings: Partial<StorageRetentionSettings> = {},
): StorageRetentionState {
  return {
    settings: {
      softBudgetMb: 500,
      hardBudgetMb: 2000,
      postIdleDays: 180,
      prunePostEvents: false,
      pruneUserEvents: false,
      ...settings,
    },
    stats: {
      generatedAt: 1,
      usageBytes: 42 * MB,
      budgetStatus: 'ok',
      eventCount: 10,
      avgEventBytes: 1024,
      estimatedEventBytes: 10 * 1024,
      idlePosts: { rows: 2, seenOnce: 1, events: 3, estimatedBytes: 2 * MB },
      outsideWot: { authors: 1, events: 1, estimatedBytes: MB },
      prune: { lastDeleted: 0, totalDeleted: 0 },
      ...overrides,
    },
  }
}

describe('StorageRetentionControls', () => {
  let root: Root
  let host: HTMLDivElement
  let current: StorageRetentionState
  let failSet = false
  const setRequests: StorageRetentionSettings[] = []

  beforeEach(() => {
    current = retentionState()
    failSet = false
    setRequests.length = 0
    host = document.createElement('div')
    document.body.replaceChildren(host)
    root = createRoot(host)
    chrome.runtime.sendMessage = (async (request: {
      type?: string
      settings?: StorageRetentionSettings
    }) => {
      if (request.type === 'GET_STORAGE_RETENTION') {
        return { ok: true, version: BACKGROUND_API_VERSION, data: current }
      }
      if (request.type === 'SET_STORAGE_RETENTION' && request.settings) {
        setRequests.push(request.settings)
        if (failSet) {
          return { ok: false, version: BACKGROUND_API_VERSION, error: 'save failed' }
        }
        current = retentionState({}, request.settings)
        return { ok: true, version: BACKGROUND_API_VERSION, data: current }
      }
      return { ok: true, version: BACKGROUND_API_VERSION, data: {} }
    }) as unknown as typeof chrome.runtime.sendMessage
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.replaceChildren()
  })

  async function render() {
    const { default: StorageRetentionControls } = await import(
      './StorageRetentionControls'
    )
    await act(async () => {
      root.render(createElement(StorageRetentionControls))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function input(labelKey: string): HTMLInputElement {
    const found = host.querySelector(`input[aria-label="${labelKey}"]`)
    if (!found) throw new Error(`missing input ${labelKey}`)
    return found as HTMLInputElement
  }

  async function edit(labelKey: string, value: string) {
    const field = input(labelKey)
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    await act(async () => {
      setter?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.focus()
      field.blur()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('shows the usage summary and the three knobs, with no user idle knob', async () => {
    await render()
    expect(host.textContent).toContain(
      'settings.storage.summary:{"used":"42.0 MB","budget":"500.0 MB","idle":"3.0 MB"}',
    )
    expect(input('settings.storage.softBudget').value).toBe('500')
    expect(input('settings.storage.hardBudget').value).toBe('2000')
    expect(input('settings.storage.postIdle').value).toBe('180')
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(3)
  })

  it('warns when over budget and when storage is not persisted', async () => {
    current = retentionState({ budgetStatus: 'overHard', persisted: false })
    await render()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'settings.storage.overHard',
    )
    expect(host.textContent).toContain('settings.storage.notPersisted')
  })

  it('saves a changed knob on blur with the full settings object', async () => {
    await render()
    await edit('settings.storage.postIdle', '30')
    expect(setRequests).toEqual([
      {
        softBudgetMb: 500,
        hardBudgetMb: 2000,
        postIdleDays: 30,
        prunePostEvents: false,
        pruneUserEvents: false,
      },
    ])
    expect(input('settings.storage.postIdle').value).toBe('30')
  })

  function toggle(labelKey: string): HTMLInputElement {
    const found = host.querySelector(`input[type="checkbox"][aria-label="${labelKey}"]`)
    if (!found) throw new Error(`missing toggle ${labelKey}`)
    return found as HTMLInputElement
  }

  it('shows both prune toggles off by default and saves one when switched on', async () => {
    await render()
    expect(host.textContent).toContain('settings.storage.pruneTitle')
    expect(host.textContent).toContain('settings.storage.prunePostsDesc')
    expect(host.textContent).toContain('settings.storage.pruneUsersDesc')
    expect(toggle('settings.storage.prunePosts').checked).toBe(false)
    expect(toggle('settings.storage.pruneUsers').checked).toBe(false)

    await act(async () => {
      toggle('settings.storage.pruneUsers').click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(setRequests).toEqual([
      expect.objectContaining({ pruneUserEvents: true, prunePostEvents: false }),
    ])
    expect(toggle('settings.storage.pruneUsers').checked).toBe(true)
  })

  it('shows the last pruning run and counts outside-WoT bytes as reclaimable', async () => {
    current = retentionState({
      prune: { lastRunAt: Date.now(), lastDeleted: 12, totalDeleted: 40 },
    })
    await render()
    expect(host.textContent).toContain('"idle":"3.0 MB"')
    expect(host.textContent).toContain('settings.storage.pruneLastRun')
    expect(host.textContent).toContain('"count":12')
  })

  function resetButton(): HTMLButtonElement {
    const found = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'settings.storage.resetDefaults',
    )
    if (!found) throw new Error('missing reset button')
    return found
  }

  it('disables Restore defaults while every knob is at its default', async () => {
    await render()
    expect(resetButton().disabled).toBe(true)
  })

  it('restores every knob to its default in one save', async () => {
    current = retentionState(
      {},
      { softBudgetMb: 900, postIdleDays: 30, prunePostEvents: true },
    )
    await render()
    expect(resetButton().disabled).toBe(false)
    await act(async () => {
      resetButton().click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(setRequests).toEqual([
      {
        softBudgetMb: 500,
        hardBudgetMb: 2000,
        postIdleDays: 180,
        prunePostEvents: false,
        pruneUserEvents: false,
      },
    ])
    expect(toggle('settings.storage.prunePosts').checked).toBe(false)
    expect(input('settings.storage.softBudget').value).toBe('500')
    expect(input('settings.storage.postIdle').value).toBe('180')
    expect(resetButton().disabled).toBe(true)
  })

  it('rolls the draft back and shows the error when save fails', async () => {
    failSet = true
    await render()
    await edit('settings.storage.softBudget', '900')
    expect(host.textContent).toContain('save failed')
    expect(input('settings.storage.softBudget').value).toBe('500')
  })
})
