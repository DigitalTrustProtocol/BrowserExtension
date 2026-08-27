/**
 * Settings overlay paths: `users`, `users/<id>/profile`, `bindings/<twitterId>`.
 */
export function parseMenuPath(
  initialSection: string | null | undefined,
): string[] {
  if (!initialSection || initialSection === 'settings') return []
  return initialSection.split('/').filter((part) => part.length > 0)
}

export function menuPathEquals(
  stack: readonly string[],
  initialSection: string | null | undefined,
): boolean {
  const initial = parseMenuPath(initialSection)
  if (initial.length === 0 || stack.length !== initial.length) return false
  return initial.every((part, index) => part === stack[index])
}

export function joinMenuPath(stack: readonly string[]): string {
  return stack.join('/')
}
