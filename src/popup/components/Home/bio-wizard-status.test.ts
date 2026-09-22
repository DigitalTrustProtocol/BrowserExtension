import { describe, expect, it } from 'vitest'
import { bioWizardStep3 } from './bio-wizard-status'

describe('bioWizardStep3', () => {
  it('is all good when completeness.bioOk is true', () => {
    expect(
      bioWizardStep3({ bioOk: true, bioMismatch: false, tooLong: true }),
    ).toBe('ok')
  })

  it('is mismatch when completeness.bioMismatch is true', () => {
    expect(
      bioWizardStep3({ bioOk: false, bioMismatch: true, tooLong: false }),
    ).toBe('mismatch')
  })

  it('is too-long only when the bio is not already decided', () => {
    expect(
      bioWizardStep3({ bioOk: false, bioMismatch: false, tooLong: true }),
    ).toBe('tooLong')
  })

  it('waits when the saved bio has not been recorded yet', () => {
    expect(
      bioWizardStep3({ bioOk: false, bioMismatch: false, tooLong: false }),
    ).toBe('waiting')
  })
})
