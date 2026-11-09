// frontend/src/components/CustomerLine.tsx
// Who this ticket belongs to: the name, and a phone number the barber can tap to call.
// Barber screens only. Customer screens never receive these details.
import { formatPhone, telHref } from '../lib/phoneLink';

export default function CustomerLine({
  name,
  phone,
  center = false,
}: {
  name: string | null | undefined;
  phone: string | null | undefined;
  center?: boolean;
}) {
  if (!name && !phone) {
    return <p className={`text-sm text-gray-600 ${center ? 'text-center' : ''}`}>No details saved</p>;
  }
  return (
    <div className={`min-w-0 ${center ? 'text-center' : ''}`}>
      {name && <p className="truncate text-base font-semibold text-ink">{name}</p>}
      {phone && (
        <a
          href={telHref(phone)}
          className="inline-flex min-h-11 items-center text-base font-medium text-blue-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Call {formatPhone(phone)}
        </a>
      )}
    </div>
  );
}