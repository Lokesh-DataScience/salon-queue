// frontend/src/components/countdown.tsx
import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';

const TEXT = { hi: { finishing: 'बस हो गया...' }, en: { finishing: 'Finishing up...' } };

export default function Countdown({ endAtMs, onExpired }: { endAtMs: number; onExpired: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  // The end time we ran out at. Once set, the countdown never goes back to counting.
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  const t = useT(TEXT);
  const callback = useRef(onExpired);
  callback.current = onExpired;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, Math.ceil((endAtMs - now) / 1000));

  useEffect(() => {
    if (left === 0) setExpiredAt((prev) => prev ?? endAtMs);
  }, [left, endAtMs]);

  // The barber added time: a clearly later end resumes the countdown.
  const extended = expiredAt !== null && endAtMs > expiredAt + 2000;
  useEffect(() => {
    if (extended) setExpiredAt(null);
  }, [extended]);

  const expired = expiredAt !== null && !extended;

  // Ask the server now, and again every 3 seconds, until this ticket moves on.
  useEffect(() => {
    if (!expired) return;
    callback.current();
    const id = setInterval(() => callback.current(), 3000);
    return () => clearInterval(id);
  }, [expired]);

  return (
    <p role="timer" className={`font-extrabold tabular-nums text-ink ${expired ? 'text-2xl' : 'text-5xl'}`}>
      {expired ? t.finishing : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
    </p>
  );
}