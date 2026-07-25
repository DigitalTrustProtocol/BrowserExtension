import {
  sanitizeObservedXIdentity,
  type ObservedXIdentity,
} from '../shared/observed-x-identity'
import type {
  IdentityRepository,
  XIdentityResolution,
} from './types'

export class MemoryIdentityRepository implements IdentityRepository {
  readonly #resolutions = new Map<string, XIdentityResolution>()
  readonly #observations = new Map<string, ObservedXIdentity[]>()

  async getResolution(
    handle: string,
  ): Promise<XIdentityResolution | undefined> {
    const resolution = this.#resolutions.get(handle)
    return resolution ? structuredClone(resolution) : undefined
  }

  async saveResolution(resolution: XIdentityResolution): Promise<void> {
    this.#resolutions.set(
      resolution.handle,
      structuredClone(resolution),
    )
  }

  async getObservations(
    handle: string,
    since: number,
  ): Promise<ObservedXIdentity[]> {
    return (this.#observations.get(handle) ?? [])
      .filter((observation) => observation.observedAt >= since)
      .map((observation) => structuredClone(observation))
  }

  async saveObservations(
    observations: readonly ObservedXIdentity[],
  ): Promise<void> {
    for (const value of observations) {
      const observation = sanitizeObservedXIdentity(value)
      if (!observation) continue
      const stored = this.#observations.get(observation.handle) ?? []
      const key = `${observation.twitterId}:${observation.sourceOperation}`
      const withoutDuplicate = stored.filter(
        (entry) => `${entry.twitterId}:${entry.sourceOperation}` !== key,
      )
      withoutDuplicate.push(structuredClone(observation))
      withoutDuplicate.sort((left, right) => right.observedAt - left.observedAt)
      this.#observations.set(
        observation.handle,
        withoutDuplicate.slice(0, 500),
      )
    }
  }
}
