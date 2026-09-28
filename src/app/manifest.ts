import type { MetadataRoute } from 'next';

/** Makes the app installable ("Add to Home Screen" / "Install app"): opens full screen, dark, with its own icon. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Business OS',
    short_name: 'Business OS',
    description: 'Run every business from one calm place.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f1216',
    theme_color: '#0f1216',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', url: '/tasks', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Inbox', url: '/inbox', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Calendar', url: '/calendar', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
