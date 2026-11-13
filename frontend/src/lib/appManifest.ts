// frontend/src/lib/appManifest.ts
// Two installable apps live on this one site:
//   barber app   manifest.webmanifest   (id "/", the barber APK was built from it: never change it)
//   customer app customer.webmanifest   (id "/c/", Chrome treats it as a different app)
// The page decides which one the browser sees, so a customer installing from a ticket page gets the
// customer app, never the barber one.
export const BARBER_MANIFEST = '/manifest.webmanifest';
export const CUSTOMER_MANIFEST = '/customer.webmanifest';

export function manifestFor(pathname: string): string {
  return /^\/barber(\/|$)/.test(pathname) ? BARBER_MANIFEST : CUSTOMER_MANIFEST;
}

// Points <link rel="manifest"> at the right file. Safe to call on every route change.
export function applyManifest(pathname: string) {
  try {
    const href = manifestFor(pathname);
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  } catch {
    /* no document (very old browsers): installing just isn't offered */
  }
}

// True when running as an installed app (home-screen icon), not in a browser tab.
export function isInstalledApp(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true // iPhone
    );
  } catch {
    return false;
  }
}
