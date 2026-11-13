import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getLang, resetLangForTests, setLang, useLang, useT } from './i18n';

afterEach(() => {
  localStorage.clear();
  resetLangForTests();
});

describe('i18n', () => {
  it('starts in Hindi when nothing is saved', () => {
    expect(getLang()).toBe('hi');
  });

  it('saves the choice and keeps it after a reload', () => {
    setLang('en');
    expect(localStorage.getItem('svq.lang.v1')).toBe('en');
    resetLangForTests(); // like opening the app again
    expect(getLang()).toBe('en');
  });

  it('ignores a corrupt saved value', () => {
    localStorage.setItem('svq.lang.v1', 'fr');
    resetLangForTests();
    expect(getLang()).toBe('hi');
  });

  it('re-renders components when the language changes', () => {
    const table = { hi: { hello: 'नमस्ते' }, en: { hello: 'Hello' } };
    const { result } = renderHook(() => ({ lang: useLang(), t: useT(table) }));
    expect(result.current.t.hello).toBe('नमस्ते');
    act(() => setLang('en'));
    expect(result.current.lang).toBe('en');
    expect(result.current.t.hello).toBe('Hello');
  });
});
