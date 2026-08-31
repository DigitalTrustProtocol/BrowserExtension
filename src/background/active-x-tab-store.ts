/**
 * Persist / load the tab-scoped X observation registry.
 *
 * @module background/active-x-tab-store
 */

import {
  ACTIVE_X_TAB_REGISTRY_KEY,
  activeXTabRegistryFromUnknown,
  emptyActiveXTabRegistry,
  pruneActiveXTabRegistry,
  type ActiveXTabRegistry,
} from '../shared/active-x-session.ts'

let memory: ActiveXTabRegistry | null = null

export function getMemoryActiveXTabRegistry(): ActiveXTabRegistry {
  return memory ?? emptyActiveXTabRegistry()
}

export async function loadActiveXTabRegistry(
  now: number,
): Promise<ActiveXTabRegistry> {
  if (memory) return pruneActiveXTabRegistry(memory, now)
  try {
    const stored = await chrome.storage.session.get(ACTIVE_X_TAB_REGISTRY_KEY)
    memory = pruneActiveXTabRegistry(
      activeXTabRegistryFromUnknown(stored[ACTIVE_X_TAB_REGISTRY_KEY]),
      now,
    )
    return memory
  } catch {
    memory = emptyActiveXTabRegistry()
    return memory
  }
}

export async function saveActiveXTabRegistry(
  registry: ActiveXTabRegistry,
): Promise<void> {
  memory = registry
  try {
    await chrome.storage.session.set({
      [ACTIVE_X_TAB_REGISTRY_KEY]: registry,
    })
  } catch {
    /* session unavailable */
  }
}

export function resetActiveXTabRegistryMemory(): void {
  memory = null
}
