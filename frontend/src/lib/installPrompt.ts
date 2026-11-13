// frontend/src/lib/installPrompt.ts
// Chrome announces "this page can be installed" once, early, with a beforeinstallprompt event.
// We keep that event so the banner's button can open Chrome's real install dialog later.
import { useSyncExternalStore } from 'react';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallEvent | null = null;
let installed = false;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Call once at start-up (main.tsx), before React renders: the event can fire very early.
export function startInstallCapture() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Barber pages: leave Chrome's own behaviour alone (barbers use the APK).
    if (/^\/barber(\/|$)/.test(window.location.pathname)) return;
    e.preventDefault(); // our banner replaces Chrome's mini bar
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export function canPromptInstall() {
  return deferred !== null;
}

export function wasJustInstalled() {
  return installed;
}

// Opens Chrome's install dialog. The saved event works only once, whatever the answer.
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  emit();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') installed = true;
    emit();
    return outcome;
  } catch {
    return 'unavailable';
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Re-renders when Chrome offers (or uses up) the install prompt, or the app gets installed.
export function useInstallState() {
  const canPrompt = useSyncExternalStore(subscribe, canPromptInstall, () => false);
  const justInstalled = useSyncExternalStore(subscribe, wasJustInstalled, () => false);
  return { canPrompt, justInstalled };
}

export function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

// Tests only.
export function resetInstallStateForTests() {
  deferred = null;
  installed = false;
  emit();
}
