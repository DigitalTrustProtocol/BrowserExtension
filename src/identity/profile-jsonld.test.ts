import { describe, expect, it } from 'vitest'
import {
  conflictingProfileHtml,
  nasaProfileHtml,
  nasaProfileMicrodataHtml,
} from './__fixtures__/profile-html'
import { extractTwitterIdsFromProfileJsonLd } from './profile-jsonld'

describe('extractTwitterIdsFromProfileJsonLd', () => {
  it('reads legacy JSON-LD mainEntity identifier', () => {
    expect(extractTwitterIdsFromProfileJsonLd(nasaProfileHtml)).toEqual([
      '11348282',
    ])
  })

  it('reads modern ProfilePage → Person microdata and ignores post ids', () => {
    expect(extractTwitterIdsFromProfileJsonLd(nasaProfileMicrodataHtml)).toEqual(
      ['11348282'],
    )
  })

  it('reports conflicting JSON-LD identifiers', () => {
    expect(extractTwitterIdsFromProfileJsonLd(conflictingProfileHtml).sort()).toEqual(
      ['111', '222'],
    )
  })
})
