import { describe, expect, it } from 'vitest'
import {
  derivePanelLifecycle,
  emptyOperatorLifecycle,
  nextLifecycleOnClear,
  nextLifecycleOnPersist,
  operatorLifecycleFromUnknown,
} from './operator-lifecycle.ts'

describe('operator lifecycle derivation', () => {
  it('is neverUsed with empty record and no accounts', () => {
    expect(derivePanelLifecycle(null, 0)).toBe('neverUsed')
    expect(derivePanelLifecycle(emptyOperatorLifecycle(1), 0)).toBe('neverUsed')
  })

  it('is active whenever accounts exist', () => {
    const cleared = nextLifecycleOnClear(null, 1, 'lastKeyDelete')
    expect(derivePanelLifecycle(cleared, 1)).toBe('active')
    const persisted = nextLifecycleOnPersist(cleared, 2)
    expect(persisted.restoreSuppressed).toBe(false)
    expect(derivePanelLifecycle(persisted, 1)).toBe('active')
  })

  it('stays keysCleared after delete until a new persist', () => {
    const afterDelete = nextLifecycleOnClear(
      nextLifecycleOnPersist(null, 1),
      2,
      'lastKeyDelete',
    )
    expect(derivePanelLifecycle(afterDelete, 0)).toBe('keysCleared')
    const afterLogout = nextLifecycleOnClear(afterDelete, 3, 'logout')
    expect(afterLogout.revision).toBe(afterDelete.revision + 1)
    expect(derivePanelLifecycle(afterLogout, 0)).toBe('keysCleared')
  })

  it('create → clear → persist → clear uses revisions not timestamps', () => {
    let rec = nextLifecycleOnPersist(null, 10)
    rec = nextLifecycleOnClear(rec, 10, 'lastKeyDelete')
    expect(derivePanelLifecycle(rec, 0)).toBe('keysCleared')
    rec = nextLifecycleOnPersist(rec, 10)
    expect(derivePanelLifecycle(rec, 1)).toBe('active')
    rec = nextLifecycleOnClear(rec, 10, 'destroy')
    expect(derivePanelLifecycle(rec, 0)).toBe('keysCleared')
    expect(rec.revision).toBe(4)
  })

  it('parses stored records and rejects junk', () => {
    const rec = nextLifecycleOnPersist(null, 5)
    expect(operatorLifecycleFromUnknown(rec)).toEqual(rec)
    expect(operatorLifecycleFromUnknown({ version: 1 })).toBeNull()
  })
})
