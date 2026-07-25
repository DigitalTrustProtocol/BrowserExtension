import React from 'react'
import ReactDOM from 'react-dom/client'
import { initI18n } from '@lib/i18n.js'
import '@shared/theme.css'
import '@shared/animations.css'
import CockpitApp from './CockpitApp'

void initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <CockpitApp />
    </React.StrictMode>,
  )
})
