import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { i18nOptions } from './resources'

void i18n
  .use(initReactI18next)
  .init({
    ...i18nOptions,
    lng: navigator.language,
  })

export default i18n
