import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostReloadQueue, type PostReloadPorts } from './post-reload-queue'

const BACKOFF_MS = 10_000

function queueWith(overrides: Partial<PostReloadPorts> = {}) {
  const calls: string[] = []
  const done: string[][] = []
  const ports: PostReloadPorts = {
    now: () => Date.now(),
    begin: async (ids: readonly string[]) => {
      calls.push(`begin:${ids.join(',')}`)
    },
    fetch: async (ids: readonly string[]) => {
      calls.push(`fetch:${ids.join(',')}`)
      return true
    },
    commit: async (ids: readonly string[]) => {
      calls.push(`commit:${ids.join(',')}`)
    },
    rollback: async (ids: readonly string[]) => {
      calls.push(`rollback:${ids.join(',')}`)
    },
    onDone: (ids: readonly string[]) => {
      done.push([...ids])
    },
    limits: {
      debounceMs: 100,
      batchSize: 2,
      spacingMs: 50,
      timeoutMs: 1_000,
      retryBackoffMs: BACKOFF_MS,
    },
    ...overrides,
  }
  return { queue: new PostReloadQueue(ports), calls, done }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PostReloadQueue', () => {
  it('debounces and dedupes, then begins, fetches, and commits a complete batch', async () => {
    const { queue, calls, done } = queueWith()
    queue.request('1')
    queue.request('1')
    queue.request('2')
    expect(queue.has('1')).toBe(true)
    expect(calls).toEqual([])

    await vi.advanceTimersByTimeAsync(100)

    expect(calls).toEqual(['begin:1,2', 'fetch:1,2', 'commit:1,2'])
    expect(done).toEqual([['1', '2']])
    expect(queue.has('1')).toBe(false)
  })

  it('runs batches of batchSize with spacing between them', async () => {
    const { queue, calls } = queueWith()
    for (const id of ['1', '2', '3']) queue.request(id)

    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toEqual(['begin:1,2', 'fetch:1,2', 'commit:1,2'])
    expect(queue.has('3')).toBe(true)

    await vi.advanceTimersByTimeAsync(49)
    expect(calls).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls.slice(3)).toEqual(['begin:3', 'fetch:3', 'commit:3'])
  })

  it('keeps ids flagged while in flight', async () => {
    let release: (complete: boolean) => void = () => {}
    const { queue } = queueWith({
      fetch: () => new Promise<boolean>((resolve) => (release = resolve)),
    })
    queue.request('7')
    await vi.advanceTimersByTimeAsync(100)
    expect(queue.has('7')).toBe(true)
    queue.request('7')

    release(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.has('7')).toBe(false)
  })

  const incomplete: PostReloadPorts['fetch'] = async () => false
  const throwing: PostReloadPorts['fetch'] = async () => {
    throw new Error('relay down')
  }

  it.each([
    ['incomplete', incomplete],
    ['throws', throwing],
  ] as const)('rolls back and backs off when the fetch %s', async (_label, fetch) => {
    const { queue, calls, done } = queueWith({ fetch })
    queue.request('9')
    await vi.advanceTimersByTimeAsync(100)

    expect(calls).toEqual(['begin:9', 'rollback:9'])
    expect(done).toEqual([['9']])
    expect(queue.has('9')).toBe(false)

    queue.request('9')
    expect(queue.has('9')).toBe(false)
    await vi.advanceTimersByTimeAsync(BACKOFF_MS)
    queue.request('9')
    expect(queue.has('9')).toBe(true)
  })

  it('aborts a fetch that runs past the timeout and rolls back', async () => {
    let aborted = false
    const { queue, calls } = queueWith({
      fetch: (_ids, signal) =>
        new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
            resolve(false)
          })
        }),
    })
    queue.request('5')
    await vi.advanceTimersByTimeAsync(100 + 1_000)
    expect(aborted).toBe(true)
    expect(calls).toEqual(['begin:5', 'rollback:5'])
  })
})
