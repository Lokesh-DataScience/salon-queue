// frontend/src/components/ShareTicket.tsx
// "Share on WhatsApp": sends the token number and a link to the salon's LIVE QUEUE page,
// so family at home can see which number is being served.
// Deliberately NOT the ticket link: that carries the secret access token, which can leave the queue.
import { useT } from '../lib/i18n';
import Icon from './Icon';

const TEXT = {
  hi: {
    button: 'WhatsApp पर भेजें',
    salon: 'सैलून',
    withLink: (n: number, salon: string, url: string) =>
      `मेरा टोकन #${n} है — ${salon}। अभी कौन-सा नंबर चल रहा है, यहाँ देखें: ${url}`,
    noLink: (n: number, salon: string) => `मेरा टोकन #${n} है — ${salon}।`,
  },
  en: {
    button: 'Share on WhatsApp',
    salon: 'the salon',
    withLink: (n: number, salon: string, url: string) =>
      `My token is #${n} at ${salon}. See which number is being served: ${url}`,
    noLink: (n: number, salon: string) => `My token is #${n} at ${salon}.`,
  },
};

export function shareText(
  t: (typeof TEXT)['hi'],
  tokenNumber: number,
  salonName: string,
  salonCode: string | null | undefined,
  origin: string,
): string {
  return salonCode
    ? t.withLink(tokenNumber, salonName, `${origin}/c/s/${encodeURIComponent(salonCode)}`)
    : t.noLink(tokenNumber, salonName);
}

export default function ShareTicket({
  tokenNumber,
  salonName,
  salonCode,
}: {
  tokenNumber: number;
  salonName?: string | null;
  salonCode?: string | null;
}) {
  const t = useT(TEXT);
  const text = shareText(t, tokenNumber, salonName || t.salon, salonCode, window.location.origin);
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className="btn-secondary gap-2"
    >
      <Icon name="share" />
      {t.button}
    </a>
  );
}
