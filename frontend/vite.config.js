import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: {
    chunkSizeWarningLimit: 1500,
    // Fonts are never inlined. Vite base64s any asset under 4 kB, which caught the smallest
    // Cyrillic subset and pushed it into the stylesheet - where it is downloaded by every
    // reader on every load, including the ones whose language never renders a single glyph
    // from it. The whole point of shipping unicode-range subsets is that they load on demand.
    assetsInlineLimit: (file) => (/\.woff2?$/i.test(file) ? false : undefined)
  }
})
