import { afterEach } from 'vitest'
import { resetChromeStorage } from './test-chrome-mock'
import * as vault from '../vault/vault.ts'

afterEach(async () => {
  try {
    if (await vault.exists()) {
      await vault.destroy()
    }
  } catch {
    /* ignore */
  }
  resetChromeStorage()
})
