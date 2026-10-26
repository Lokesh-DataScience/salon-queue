// frontend/src/components/PageShell.tsx
import { useEffect, type ReactNode } from 'react';

type Props = { title?: string; width?: 'narrow' | 'wide'; children: ReactNode };

export default function PageShell({ title, width = 'narrow', children }: Props) {
  useEffect(() => {
    if (title) document.title = `${title} · Salon Virtual Queue`;
  }, [title]);

  return (
    <main
      className={`mx-auto w-full px-4 py-6 ${width === 'wide' ? 'max-w-md md:max-w-3xl' : 'max-w-md'}`}
    >
      {children}
    </main>
  );
}