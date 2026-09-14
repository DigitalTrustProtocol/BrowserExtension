/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import {
  layoutCenterNode,
  pickGraphNodeAt,
  pinSettledForceNodes,
} from './ForceGraphCanvas'
import type { GraphVizNode } from './types'

function node(
  id: string,
  x: number,
  y: number,
  extras: Partial<GraphVizNode> = {},
): GraphVizNode {
  return {
    id,
    kind: 'twitter_id',
    depth: 1,
    label: id,
    x,
    y,
    ...extras,
  }
}

describe('pickGraphNodeAt', () => {
  it('returns the node whose disc contains the point', () => {
    const alice = node('alice', 0, 0)
    const bob = node('bob', 40, 0)
    expect(pickGraphNodeAt([alice, bob], 2, 1)?.id).toBe('alice')
    expect(pickGraphNodeAt([alice, bob], 41, 0)?.id).toBe('bob')
  })

  it('returns undefined when the point misses every disc', () => {
    expect(pickGraphNodeAt([node('alice', 0, 0)], 80, 80)).toBeUndefined()
  })

  it('picks the closer node when discs overlap', () => {
    const left = node('left', 0, 0)
    const right = node('right', 4, 0)
    expect(pickGraphNodeAt([left, right], 1, 0)?.id).toBe('left')
    expect(pickGraphNodeAt([left, right], 3, 0)?.id).toBe('right')
  })
})

describe('pinSettledForceNodes', () => {
  it('keeps You off the origin when another node is the focus', () => {
    const elon = node('elon', 0, 0, { isFocus: true, depth: 0 })
    const you = node('you', 80, 40, {
      isRoot: true,
      kind: 'pubkey',
      depth: 1,
      label: 'You',
    })
    pinSettledForceNodes([elon, you])
    expect(layoutCenterNode([elon, you])?.id).toBe('elon')
    expect(elon).toMatchObject({ fx: 0, fy: 0, x: 0, y: 0 })
    expect(you.x).toBe(80)
    expect(you.y).toBe(40)
    expect(you.fx).toBe(80)
    expect(you.fy).toBe(40)
  })

  it('pins You at origin only when You is the focus', () => {
    const you = node('you', 12, -8, {
      isRoot: true,
      isFocus: true,
      kind: 'pubkey',
      depth: 0,
      label: 'You',
    })
    pinSettledForceNodes([you])
    expect(you).toMatchObject({ fx: 0, fy: 0, x: 0, y: 0 })
  })
})
