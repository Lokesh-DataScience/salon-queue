// frontend/src/test/english.ts
// Older page tests look for English text. Customer pages now default to Hindi,
// so these tests switch to English before each test.
// The language is set in memory only: localStorage is left empty, so tests that check
// "nothing else is stored on the phone" still pass.
import { beforeEach } from 'vitest';
import { resetLangForTests } from '../lib/i18n';

const KEY = 'svq.lang.v1';

export function englishForEachTest() {
  beforeEach(() => {
    localStorage.setItem(KEY, 'en');
    resetLangForTests(); // loads 'en' from storage
    localStorage.removeItem(KEY); // ...then leaves storage empty
  });
}