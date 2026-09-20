import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173 },
  build: { target: 'es2020' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Swarmguard — Defend the Core',
        short_name: 'Swarmguard',
        description:
          'Free colorful tower defense in your browser. Build towers, pop monster swarms, survive 10 waves.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#141a30',
        theme_color: '#1a2440',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell is fully precached; the visit counter stays network-only.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        globIgnores: ['og-image.png'],
      },
    }),
  ],
});
