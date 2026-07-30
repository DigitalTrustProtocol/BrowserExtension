import { applyPageColorScheme } from './theme'

const POPOVER_STYLE = `
  :host {
    color-scheme: inherit;
  }
  .shell {
    position: fixed;
    display: none;
    pointer-events: auto;
    max-width: 340px;
    filter: drop-shadow(0 8px 24px rgba(0, 0, 0, .28));
  }
`

const MARGIN = 8

let host: HTMLElement | undefined
let shell: HTMLElement | undefined
let panel: HTMLElement | undefined
let teardown: (() => void) | undefined
let currentAnchor: HTMLElement | undefined
let outsideCloseTimer: ReturnType<typeof setTimeout> | undefined

function ensureHost(): void {
  if (host?.isConnected && shell && panel) {
    applyPageColorScheme(host)
    return
  }
  host = document.createElement('div')
  host.dataset.attentionxPopover = 'true'
  // Avoid `all: initial` — it forces color-scheme: initial (light) and fights X dark mode.
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:block;margin:0;padding:0;border:0;background:transparent;'
  applyPageColorScheme(host)
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>${POPOVER_STYLE}</style>
    <div class="shell"><div class="panel"></div></div>
  `
  shell = root.querySelector('.shell') as HTMLElement
  panel = root.querySelector('.panel') as HTMLElement
  document.documentElement.append(host)
}

function place(anchor: HTMLElement): void {
  if (!shell) return
  const rect = anchor.getBoundingClientRect()
  shell.style.display = 'block'
  shell.style.left = `${Math.max(MARGIN, rect.left)}px`
  shell.style.top = `${rect.bottom + MARGIN}px`

  requestAnimationFrame(() => {
    if (!shell) return
    const box = shell.getBoundingClientRect()
    if (box.right > window.innerWidth - MARGIN) {
      shell.style.left = `${Math.max(MARGIN, window.innerWidth - box.width - MARGIN)}px`
    }
    if (box.bottom > window.innerHeight - MARGIN) {
      shell.style.top = `${Math.max(MARGIN, rect.top - box.height - MARGIN)}px`
    }
  })
}

/**
 * Opens the single shared popover anchored to `anchorEl`. `mount` may return a
 * cleanup function that runs when the popover closes.
 */
export function openPopover(
  anchorEl: HTMLElement,
  mount: (container: HTMLElement) => void | (() => void),
): void {
  if (currentAnchor === anchorEl && teardown) {
    closePopover()
    return
  }
  closePopover()
  ensureHost()
  if (!panel || !host) return
  applyPageColorScheme(host)

  const cleanup = mount(panel)
  currentAnchor = anchorEl
  place(anchorEl)

  const onPointerDown = (event: Event) => {
    const path = event.composedPath()
    if (shell && path.includes(shell)) return
    if (path.includes(anchorEl)) return
    closePopover()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closePopover()
  }
  const onScroll = () => closePopover()

  // Defer outside-close so the opening gesture cannot immediately dismiss.
  outsideCloseTimer = setTimeout(() => {
    outsideCloseTimer = undefined
    window.addEventListener('pointerdown', onPointerDown, true)
  }, 0)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)

  teardown = () => {
    if (outsideCloseTimer !== undefined) {
      clearTimeout(outsideCloseTimer)
      outsideCloseTimer = undefined
    }
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll)
    if (typeof cleanup === 'function') cleanup()
  }
}

export function closePopover(): void {
  teardown?.()
  teardown = undefined
  currentAnchor = undefined
  panel?.replaceChildren()
  if (shell) shell.style.display = 'none'
}

export function destroyPopover(): void {
  closePopover()
  host?.remove()
  host = undefined
  shell = undefined
  panel = undefined
}
