// frontend/src/pages/ShopRecover.tsx — get your orders back on a new phone (/c/shop/recover), Commerce C5b (§9.4).
// The old phone is lost (or a device-link code isn't possible): the customer calls the shop, the founder calls
// back the number on the order and reads out a 6-digit code. Number + code here → this phone sees the orders and
// the saved details. One answer for every failure, so this screen never reveals whether a number has orders.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageShell from '../components/PageShell';
import CustomerHeader from '../components/CustomerHeader';
import { redeemRecoveryCode } from '../api/shopOrders';
import { fetchShopContact } from '../api/shop';
import { useT } from '../lib/i18n';

const TEXT = {
  hi: {
    title: 'ऑर्डर वापस पाएँ',
    back: 'मेरे ऑर्डर',
    steps: [
      'दुकान को फ़ोन करें और बताएँ कि आपको नए फ़ोन पर ऑर्डर देखने हैं।',
      'दुकान आपके ऑर्डर वाले नंबर पर वापस फ़ोन करेगी और 6 अंकों का कोड बताएगी।',
      'नीचे वही नंबर और कोड डालें। कोड 15 मिनट तक, एक ही बार चलेगा।',
    ],
    call: (p: string) => `दुकान को फ़ोन करें: ${p}`,
    phone: 'ऑर्डर वाला मोबाइल नंबर',
    code: '6 अंकों का कोड',
    submit: 'ऑर्डर वापस पाएँ',
    working: 'जाँच रहे हैं...',
    done: 'हो गया! अब यह फ़ोन आपके ऑर्डर और सेव किया पता देख सकता है।',
    safety: 'कोड सिर्फ़ तभी डालें जब दुकान ने आपको फ़ोन पर बताया हो। किसी और को कोड न बताएँ।',
  },
  en: {
    title: 'Get your orders back',
    back: 'My Orders',
    steps: [
      'Call the shop and say you want to see your orders on a new phone.',
      'The shop calls you back on the number you ordered with and tells you a 6-digit code.',
      'Enter that number and the code below. The code works once, for 15 minutes.',
    ],
    call: (p: string) => `Call the shop: ${p}`,
    phone: 'Mobile number you ordered with',
    code: '6-digit code',
    submit: 'Get my orders back',
    working: 'Checking...',
    done: 'Done! This phone now sees your orders and saved details.',
    safety: 'Only enter a code the shop told you on a call. Never share the code with anyone else.',
  },
};

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

export default function ShopRecover() {
  const t = useT(TEXT);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const contactQ = useQuery({ queryKey: ['shopContact'], queryFn: fetchShopContact, staleTime: 5 * 60_000, retry: false });
  const contact = contactQ.data?.contactPhone;
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const redeem = useMutation({
    mutationFn: () => redeemRecoveryCode(phone.trim(), code.replace(/\D/g, '')),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['shopMyOrders'] });
      await qc.invalidateQueries({ queryKey: ['shopPrefill'] });
      setTimeout(() => navigate('/c/shop/orders'), 1200);
    },
  });
  const ready = /^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10)) && code.replace(/\D/g, '').length === 6;

  return (
    <PageShell title={t.title}>
      <CustomerHeader title={t.title} backTo="/c/shop/orders" backLabel={t.back} />
      <ol className="card mb-4 grid list-decimal gap-2 pl-8 text-base text-gray-800">
        {t.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {contact && (
        <a href={`tel:${contact}`} className="btn-secondary mb-4 min-h-12 w-full">
          {t.call(contact)}
        </a>
      )}
      <form
        className="card grid gap-3"
        aria-label={t.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) redeem.mutate();
        }}
      >
        <div>
          <label htmlFor="rec-phone" className="mb-1 block text-base font-medium">
            {t.phone}
          </label>
          <input
            id="rec-phone"
            className="field"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rec-code" className="mb-1 block text-base font-medium">
            {t.code}
          </label>
          <input
            id="rec-code"
            className="field text-center font-mono text-2xl tracking-widest"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <p className="text-sm font-semibold text-red-800">{t.safety}</p>
        {redeem.isError && (
          <p role="alert" className="text-sm text-red-800">
            {errText(redeem.error)}
          </p>
        )}
        {redeem.isSuccess && (
          <p role="status" className="text-base font-semibold text-green-800">
            {t.done}
          </p>
        )}
        <button type="submit" className="btn-primary min-h-12" disabled={!ready || redeem.isPending || redeem.isSuccess}>
          {redeem.isPending ? t.working : t.submit}
        </button>
      </form>
    </PageShell>
  );
}
