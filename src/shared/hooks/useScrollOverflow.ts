import { useEffect, useState, type RefObject } from 'react'

/** True when content is taller than the visible box (with a 1px slop for subpixel rounding). */
export function scrollContainerOverflows(
  el: Pick<Element, 'scrollHeight' | 'clientHeight'>,
  slopPx = 1,
): boolean {
  return el.scrollHeight > el.clientHeight + slopPx
}

/**
 * Tracks whether `ref` currently overflows. Re-measures on resize, child
 * mutations, and when `resetKey` changes (e.g. wizard step).
 */
export function useScrollOverflow(
  ref: RefObject<HTMLElement | null>,
  resetKey?: unknown,
): boolean {
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) {
      setOverflows(false)
      return
    }

    const update = () => {
      setOverflows(scrollContainerOverflows(el))
    }

    update()

    const ro = new ResizeObserver(update)
    ro.observe(el)
    for (const child of el.children) {
      ro.observe(child)
    }

    const mo = new MutationObserver(() => {
      for (const child of el.children) {
        ro.observe(child)
      }
      update()
    })
    mo.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref, resetKey])

  return overflows
}
