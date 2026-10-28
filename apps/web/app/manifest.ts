import type { MetadataRoute } from 'next';

/** Installable "Mi trabajo" (PWA): opens straight on the user's tasks. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cotizador EE · Mi trabajo',
    short_name: 'Cotizador EE',
    start_url: '/inicio',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#00457F',
    lang: 'es',
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
