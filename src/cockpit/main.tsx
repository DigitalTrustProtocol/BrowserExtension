import React from 'react'
import ReactDOM from 'react-dom/client'
import { initI18n } from '@lib/i18n.js'
import { applyExtensionColorScheme } from '@shared/apply-extension-color-scheme.ts'
import '@shared/theme.css'
import '@shared/animations.css'
import ApplicationApp from './ApplicationApp'

void Promise.all([initI18n(), applyExtensionColorScheme()]).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ApplicationApp />
    </React.StrictMode>,
  )
})
