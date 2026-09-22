/**
 * Cheap Browser Sync Easy-blob presence. Boolean only — never reads ncryptsec.
 *
 * @module shared/easy-restore-available
 */

import { describe, expect, it } from 'vitest'
import { easyRestoreAvailableFromSyncValues } from './easy-restore-available.ts'

describe('easyRestoreAvailableFromSyncValues', () => {
  it('is true for a live v1 blob with a pubkey hint', () => {
    expect(
      easyRestoreAvailableFromSyncValues(
        { version: 1, pubkeyHint: 'aa'.repeat(32) },
        null,
      ),
    ).toBe(true)
  })

  it('is true for a live v2 map entry and ignores deleted rows', () => {
    expect(
      easyRestoreAvailableFromSyncValues(null, {
        version: 2,
        byTwitterId: {
          '1': { deleted: true, pubkeyHint: 'aa'.repeat(32) },
          '2': { pubkeyHint: 'bb'.repeat(32) },
        },
      }),
    ).toBe(true)
  })

  it('is false when every v2 entry is deleted and v1 is missing', () => {
    expect(
      easyRestoreAvailableFromSyncValues(undefined, {
        version: 2,
        byTwitterId: {
          '1': { deleted: true, pubkeyHint: 'aa'.repeat(32) },
        },
      }),
    ).toBe(false)
  })
})
