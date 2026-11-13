// frontend/src/hooks/useOnline.ts
// true while the phone has a network connection. Queries refetch on their own when it comes back.
import { useSyncExternalStore } from 'react';

function subscribe(fn: () => void) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
