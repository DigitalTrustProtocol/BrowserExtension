import { describe, expect, it } from 'vitest'
import { CONTENT_EN } from '../content/i18n/fallback-en'
import { t, resetContentI18nForTests } from '../content/i18n'
import { resources } from './resources'
import en from '../../public/locales/en.json'
import da from '../../public/locales/da.json'
import de from '../../public/locales/de.json'
import es from '../../public/locales/es.json'
import fr from '../../public/locales/fr.json'
import itLocale from '../../public/locales/it.json'
import pt from '../../public/locales/pt.json'

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'object' && child !== null
      ? leafKeys(child, path)
      : [path]
  })
}

describe('legacy translation resources', () => {
  it('keeps Danish popup keys aligned with English', () => {
    expect(leafKeys(resources.da.translation).sort()).toEqual(
      leafKeys(resources.en.translation).sort(),
    )
  })
})

describe('content locale catalog', () => {
  it('keeps embedded English aligned with public/locales/en.json content.*', () => {
    const jsonKeys = Object.keys(en)
      .filter((key) => key.startsWith('content.'))
      .sort()
    expect(Object.keys(CONTENT_EN).sort()).toEqual(jsonKeys)
    for (const key of jsonKeys) {
      expect(en[key as keyof typeof en]).toBe(CONTENT_EN[key])
    }
  })

  it('keeps Danish content keys aligned with English content keys', () => {
    const enKeys = Object.keys(en)
      .filter((key) => key.startsWith('content.'))
      .sort()
    const daKeys = Object.keys(da)
      .filter((key) => key.startsWith('content.'))
      .sort()
    expect(daKeys).toEqual(enKeys)
  })

  it('interpolates with single braces from embedded English', () => {
    resetContentI18nForTests()
    expect(t('content.card.networkCounts', { trust: 2, distrust: 1 })).toBe(
      '2 trust · 1 distrust',
    )
  })
})

describe('X-id data-layer copy', () => {
  const keys = [
    'panel.subjectHeader.unknownUser',
    'panel.subjectHeader.notIdentifiedYet',
    'panel.subjectHeader.externalTrusted',
    'panel.subjectHeader.openXProfile',
    'panel.notes.outgoingUnavailable',
    'graph.externalTrusted',
    'graph.filterFinalStatements',
    'graph.filterFinalStatementsHint',
    'graph.reset',
    'graph.refresh',
    'graph.staleHint',
  ] as const

  it('keeps unidentified and outgoing-unavailable keys in every locale', () => {
    for (const catalog of [en, da, de, es, fr, itLocale, pt]) {
      for (const key of keys) {
        expect(catalog[key].trim().length).toBeGreaterThan(0)
      }
    }
  })
})
