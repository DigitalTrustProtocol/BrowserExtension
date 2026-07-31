/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import {
  findConnectPeopleSlot,
  resolveConnectPeopleHandle,
} from './connect-people'

function buildUserCell(handle: string, displayName: string): HTMLElement {
  const cell = document.createElement('button')
  cell.dataset.testid = 'UserCell'
  cell.innerHTML = `
    <div class="row">
      <div class="name">
        <a href="/${handle}">${displayName}</a>
        <a href="/${handle}">@${handle}</a>
      </div>
      <div class="follow">
        <button data-testid="${handle}-follow">Follow</button>
      </div>
      <div class="a11y">Click to Follow ${handle}</div>
    </div>
  `
  return cell
}

describe('resolveConnectPeopleHandle', () => {
  it('reads the profile handle from cell links', () => {
    const cell = buildUserCell('alice', 'Alice')
    expect(resolveConnectPeopleHandle(cell)).toBe('alice')
  })
})

describe('findConnectPeopleSlot', () => {
  it('locates the name and follow columns inside a UserCell', () => {
    const cell = buildUserCell('bob', 'Bob')
    document.body.append(cell)

    const slot = findConnectPeopleSlot(cell)
    expect(slot).toBeDefined()
    expect(slot?.handle).toBe('bob')
    expect(slot?.nameColumn.textContent).toContain('Bob')
    expect(slot?.followColumn.querySelector('[data-testid="bob-follow"]')).toBeTruthy()

    cell.remove()
  })
})
