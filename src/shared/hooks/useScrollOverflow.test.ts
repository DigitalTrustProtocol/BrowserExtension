import { describe, expect, it } from 'vitest'
import { scrollContainerOverflows } from './useScrollOverflow.ts'

describe('scrollContainerOverflows', () => {
  it('is false when content fits', () => {
    expect(
      scrollContainerOverflows({ scrollHeight: 200, clientHeight: 200 }),
    ).toBe(false)
    expect(
      scrollContainerOverflows({ scrollHeight: 200, clientHeight: 240 }),
    ).toBe(false)
  })

  it('is false for 1px subpixel rounding', () => {
    expect(
      scrollContainerOverflows({ scrollHeight: 201, clientHeight: 200 }),
    ).toBe(false)
  })

  it('is true when content is taller than the box', () => {
    expect(
      scrollContainerOverflows({ scrollHeight: 400, clientHeight: 200 }),
    ).toBe(true)
    expect(
      scrollContainerOverflows({ scrollHeight: 202, clientHeight: 200 }),
    ).toBe(true)
  })
})
