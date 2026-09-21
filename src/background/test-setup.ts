import { afterEach } from 'vitest'
import { resetChromeStorage } from './test-chrome-mock'
import { clearCachedFocusedProductTab } from './focused-tab-cache.ts'
import { resetActiveXTabRegistryMemory } from './active-x-tab-store.ts'
import { resetOperatorBindingChangedListenerForTests } from '../accounts/operator-binding-changed.ts'
import * as vault from '../vault/vault.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) {
      await vault.destroy()
    }
  } catch {
    /* ignore */
  }
  clearCachedFocusedProductTab()
  resetActiveXTabRegistryMemory()
  resetOperatorBindingChangedListenerForTests()
  resetChromeStorage()
})
