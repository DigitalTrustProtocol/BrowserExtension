import { useCallback, useEffect, useState } from 'react'
import Card from '@components/Card/Card'
import Button from '@components/Button/Button'
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel'
import { rpc } from '../../shared/rpc'
import {
  ADMIN_TEST_MNEMONIC,
  ADMIN_TEST_VAULT_PASSWORD,
  type KeyScenarioId,
  type KeyScenarioStatus,
} from '../../shared/admin-key-scenarios'
import styles from '../CockpitApp.module.css'
import adminStyles from './AdminPage.module.css'

const SCENARIOS: Array<{
  id: KeyScenarioId
  title: string
  body: string
  showSeed?: boolean
  showPassword?: boolean
}> = [
  {
    id: 'firstRun',
    title: 'Clean state — no keys, no prior delete',
    body: 'Destroys the local vault and operator lifecycle so the side panel shows the Demo / Live intro. Clears Chrome Sync Easy blobs and bindings. Does not touch IndexedDB events or the X profile.',
  },
  {
    id: 'afterDelete',
    title: 'Clean state — prior deleted keys',
    body: 'Empty vault with keysCleared lifecycle (afterKeyClear route). Writes a Sync tombstone for twitter id 22551796 using the test seed’s public key so roaming restore stays suppressed.',
  },
  {
    id: 'oneKeyBound',
    title: 'One key imported — bound to this X',
    body: 'Never-lock vault with the hard-coded test seed (NIP-06 index 0). Soft-binds to the signed-in X id when known so Home can load. Does not write X bio or kind 10011.',
    showSeed: true,
  },
  {
    id: 'oneKeyUnbound',
    title: 'One key imported — unbound',
    body: 'Same never-lock test key with no X binding. On an X tab the panel offers bind / create instead of Home.',
    showSeed: true,
  },
  {
    id: 'lockedVault',
    title: 'Locked vault',
    body: 'Same test key behind a password so the panel shows Unlock. Auto-lock uses the default timed interval.',
    showSeed: true,
    showPassword: true,
  },
  {
    id: 'twoKeys',
    title: 'Two keys from the test seed',
    body: 'HD index 0 (active, bound when possible) plus index 1 unbound. Use this to exercise Settings → Nostr Keys list and switch.',
    showSeed: true,
  },
]

function formatStatus(status: KeyScenarioStatus): string {
  const bound =
    status.boundTwitterIds.length > 0
      ? status.boundTwitterIds.join(', ')
      : 'none'
  const lock = !status.vaultExists
    ? 'no vault'
    : status.vaultLocked
      ? 'locked'
      : status.neverLock
        ? 'never-lock'
        : 'unlocked'
  return `lifecycle ${status.lifecycle} · ${status.accountCount} key(s) · ${lock} · bound X ${bound}`
}

interface AdminPageProps {
  refreshToken: number
}

export default function AdminPage({ refreshToken }: AdminPageProps) {
  const [status, setStatus] = useState<KeyScenarioStatus>()
  const [busyId, setBusyId] = useState<KeyScenarioId | 'status'>()
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    setBusyId('status')
    setError('')
    try {
      setStatus(await rpc<KeyScenarioStatus>('admin_getKeyScenarioStatus'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load key status')
    } finally {
      setBusyId(undefined)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus, refreshToken])

  const apply = async (id: KeyScenarioId) => {
    if (busyId) return
    setBusyId(id)
    setError('')
    try {
      setStatus(
        await rpc<KeyScenarioStatus>('admin_applyKeyScenario', {
          scenario: id,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply scenario')
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <section className={styles.section}>
      <Card className={adminStyles.statusCard}>
        <SectionLabel>Current vault</SectionLabel>
        <SectionHint>
          Key-management fixtures only. IndexedDB events, xIdentities, and the
          X profile are left alone.
        </SectionHint>
        <p className={adminStyles.statusLine}>
          {status ? formatStatus(status) : 'Loading…'}
        </p>
      </Card>

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={adminStyles.stack}>
        {SCENARIOS.map((scenario) => (
          <Card key={scenario.id}>
            <div className={adminStyles.cardHead}>
              <h2 className={adminStyles.cardTitle}>{scenario.title}</h2>
              <Button
                small
                disabled={busyId !== undefined}
                onClick={() => {
                  void apply(scenario.id)
                }}
              >
                {busyId === scenario.id ? 'Applying…' : 'Apply'}
              </Button>
            </div>
            <p className={adminStyles.cardBody}>{scenario.body}</p>
            {scenario.showSeed ? (
              <p className={adminStyles.seed}>{ADMIN_TEST_MNEMONIC}</p>
            ) : null}
            {scenario.showPassword ? (
              <p className={adminStyles.seed}>
                Unlock password: {ADMIN_TEST_VAULT_PASSWORD}
              </p>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  )
}
