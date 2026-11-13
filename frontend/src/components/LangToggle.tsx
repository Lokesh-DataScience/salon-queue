// frontend/src/components/LangToggle.tsx
// Shows the OTHER language: "EN" while in Hindi, "हिं" while in English.
import { setLang, useLang } from '../lib/i18n';

export default function LangToggle() {
  const lang = useLang();
  const next = lang === 'hi' ? 'en' : 'hi';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      lang={next}
      aria-label={lang === 'hi' ? 'Switch to English' : 'हिंदी में देखें'}
      className="c-chip"
    >
      {lang === 'hi' ? 'EN' : 'हिं'}
    </button>
  );
}
