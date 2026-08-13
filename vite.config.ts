import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@components': resolve(__dirname, 'src/components'),
  '@assets': resolve(__dirname, 'src/assets'),
  '@lib': resolve(__dirname, 'src/lib'),
}

/** Keep the unpacked extension loadable while emptyOutDir wipes dist/. */
function restoreExtensionShell() {
  return {
    name: 'restore-extension-shell',
    buildStart() {
      const dist = resolve(__dirname, 'dist')
      const assets = resolve(dist, 'assets')
      mkdirSync(assets, { recursive: true })
      const manifestDest = resolve(dist, 'manifest.json')
      if (!existsSync(manifestDest)) {
        copyFileSync(resolve(__dirname, 'public/manifest.json'), manifestDest)
      }
      const sw = resolve(assets, 'background.js')
      if (!existsSync(sw)) {
        writeFileSync(sw, "'use strict';\n")
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), restoreExtensionShell()],
  resolve: { alias },
  publicDir: 'public',
  build: {
    emptyOutDir: true,
    // Chrome MV3 treats <link rel="modulepreload"> as unused cross-world
    // resources and surfaces Errors on the extension card.
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        onboarding: resolve(__dirname, 'src/onboarding/index.html'),
        prompt: resolve(__dirname, 'src/prompt/index.html'),
        cockpit: resolve(__dirname, 'src/cockpit/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
