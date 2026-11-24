import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Preloads the two critical faces (Roboto Flex Latin, Baloo Da 2 Bengali) from the hashed build output. */
function preloadFonts(): Plugin {
  return {
    name: 'relief-preload-fonts',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const fonts = Object.keys(ctx.bundle).filter((f) => /(roboto-flex-latin-standard|baloo-da-2-bengali).*\.woff2$/.test(f));
        return {
          html,
          tags: fonts.map((f) => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${f}`, crossorigin: '' }, injectTo: 'head' as const })),
        };
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    preloadFonts(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Dishari · দিশারী — Disaster Relief',
        short_name: 'Dishari',
        description: 'Offline-first household registration and relief distribution for volunteer groups.',
        lang: 'bn',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F9FAFC',
        theme_color: '#1B3B6F',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The whole app shell and the bundled fonts are precached: a cold start works with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true } },
  },
  preview: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true } },
  },
  build: { target: 'es2020', sourcemap: true, chunkSizeWarningLimit: 900 },
});
