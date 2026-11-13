// frontend/src/lib/i18n.ts
// Customer pages speak Hindi by default; the EN button switches to English.
// Each component keeps its own { hi, en } text table and picks one with useT().
// Only the choice "hi" / "en" is stored on the phone, nothing about the customer.
import { useSyncExternalStore } from 'react';

export type Lang = 'hi' | 'en';

const KEY = 'svq.lang.v1';

function read(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'hi';
  } catch {
    return 'hi'; // storage blocked: Hindi
  }
}

let current: Lang = read();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked: the choice lasts until the page closes */
  }
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => 'hi' as Lang);
}

// const t = useT(TEXT); t.title ...
export function useT<T>(table: { hi: T; en: T }): T {
  return table[useLang()];
}

// Tests only.
export function resetLangForTests() {
  current = read();
  listeners.forEach((l) => l());
}
