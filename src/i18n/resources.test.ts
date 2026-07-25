import { describe, expect, it } from 'vitest'
import { resources } from './resources'

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null
      ? leafKeys(child, path)
      : [path]
  })
}

describe('translation resources', () => {
  it('keeps Danish translation keys aligned with English', () => {
    expect(leafKeys(resources.da.translation).sort()).toEqual(
      leafKeys(resources.en.translation).sort(),
    )
  })
})
