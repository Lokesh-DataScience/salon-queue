// frontend/src/components/countdown.tsx
import { useEffect, useRef, useState } from 'react';

export default function Countdown({ endAtMs, onExpired }: { endAtMs: number; onExpired: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const callback = useRef(onExpired);
  callback.current = onExpired;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, Math.ceil((endAtMs - now) / 1000));
  const expired = left === 0;

  // At zero, re-check with the server now and every 10 seconds until the ticket moves on.
  useEffect(() => {
    if (!expired) return;
    callback.current();
    const id = setInterval(() => callback.current(), 10_000);
    return () => clearInterval(id);
  }, [expired]);

  return (
    <p role="timer" className={`font-extrabold tabular-nums text-ink ${expired ? 'text-2xl' : 'text-5xl'}`}>
      {expired ? 'Finishing up...' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
    </p>
  );
}