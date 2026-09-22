export type BioWizardStep3Kind = 'ok' | 'mismatch' | 'tooLong' | 'waiting'

/**
 * Step 3 follows binding completeness (`xNpub` vs this key), not a live
 * DOM snapshot. `tooLong` is the one-shot copy suggestion only.
 */
export function bioWizardStep3(input: {
  bioOk: boolean
  bioMismatch: boolean
  tooLong: boolean
}): BioWizardStep3Kind {
  if (input.bioOk) return 'ok'
  if (input.bioMismatch) return 'mismatch'
  if (input.tooLong) return 'tooLong'
  return 'waiting'
}
