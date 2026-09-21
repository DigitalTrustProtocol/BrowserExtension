/**
 * Hook so vault bind/unbind can refresh operator Bio / 10011 completeness
 * without importing the backend module.
 */

type OperatorBindingChangedListener = (twitterId: string) => Promise<void>

let listener: OperatorBindingChangedListener | undefined

export function setOperatorBindingChangedListener(
  next: OperatorBindingChangedListener | undefined,
): void {
  listener = next
}

export async function notifyOperatorBindingChanged(
  twitterId: string,
): Promise<void> {
  try {
    await listener?.(twitterId)
  } catch {
    /* bind already persisted; chrome refresh is best-effort */
  }
}

export function resetOperatorBindingChangedListenerForTests(): void {
  listener = undefined
}
