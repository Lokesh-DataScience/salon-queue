// frontend/src/components/admin/shop/ShopCustomerAccess.tsx — which phones can see this customer's orders,
// founder-callback recovery codes, and removing a lost phone's access (Commerce C5b, §9.4).
// The code is shown once, here, right after the founder has called the number on the customer record.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRecoveryCode, fetchShopCustomer, revokeShopKey } from '../../../api/shopAdmin';
import { fmtWhen } from './orderLabels';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

export default function ShopCustomerAccess({ customerId, readOnly }: { customerId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['shopCustomer', customerId], queryFn: () => fetchShopCustomer(customerId) });
  const [called, setCalled] = useState(false);
  const make = useMutation({
    mutationFn: () => createRecoveryCode(customerId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shopCustomer', customerId] }),
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => revokeShopKey(customerId, keyId),
    onSuccess: (d) => qc.setQueryData(['shopCustomer', customerId], d),
  });
  const [confirming, setConfirming] = useState<string | null>(null);

  if (q.isPending) return <p className="text-gray-600">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-red-700">{errText(q.error)}</p>;
  const d = q.data;

  return (
    <div className="grid gap-4">
      <p className="text-sm text-gray-700">
        {d.orders.length} {d.orders.length === 1 ? 'order' : 'orders'} on {d.customer.phone}
        {d.customer.phoneVerifiedAt ? ` · number confirmed ${fmtWhen(d.customer.phoneVerifiedAt)}` : ''}
      </p>

      <div className="grid gap-2">
        <h4 className="font-semibold">Phones that can see these orders</h4>
        {d.devices.length === 0 && <p className="text-sm text-gray-700">None.</p>}
        <ul className="grid gap-2">
          {d.devices.map((dev) => {
            const active = dev.keys.filter((k) => !k.revokedAt);
            return (
              <li key={dev.label} className="rounded-xl border-2 border-gray-200 p-3 text-sm">
                <span className="block font-semibold">
                  {dev.label}
                  {dev.verifiedBy === 'FOUNDER_CALLBACK' ? ' · recovered with your code' : dev.verifiedAt ? ' · confirmed' : ''}
                  {dev.placedOrders ? ` · placed ${dev.placedOrders}` : ''}
                </span>
                {active.length === 0 && <span className="block text-gray-600">No access any more.</span>}
                {active.map((k) => (
                  <span key={k.id} className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-gray-700">
                      Since {fmtWhen(k.createdAt)} · last used {fmtWhen(k.lastSeenAt)}
                    </span>
                    {!readOnly &&
                      (confirming === k.id ? (
                        <>
                          <button type="button" className="btn-danger min-h-11" disabled={revoke.isPending} onClick={() => revoke.mutate(k.id, { onSettled: () => setConfirming(null) })}>
                            Yes, remove access
                          </button>
                          <button type="button" className="btn-secondary min-h-11" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn-secondary min-h-11" onClick={() => setConfirming(k.id)}>
                          Remove access (lost phone)…
                        </button>
                      ))}
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
        {revoke.isError && <p role="alert" className="text-red-700">{errText(revoke.error)}</p>}
      </div>

      {!readOnly && (
        <div className="grid gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 p-3">
          <h4 className="font-semibold">Customer has a new phone?</h4>
          <ol className="list-decimal pl-5 text-sm text-gray-800">
            <li>Call {d.customer.phone} yourself — the number on the order, never a number they give you now.</li>
            <li>Make a code and read it out on that call. It works once, for 15 minutes.</li>
            <li>They open "Get your orders back" in My Orders and enter the number and the code.</li>
          </ol>
          {make.data ? (
            <div role="status" className="grid gap-1 text-center">
              <span className="text-sm">Read this out on the call:</span>
              <span className="font-mono text-4xl font-extrabold tracking-widest">{make.data.code}</span>
              <span className="text-sm text-gray-700">Valid until {fmtWhen(make.data.expiresAt)}. It isn't shown again.</span>
            </div>
          ) : (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} />
                I have called {d.customer.phone} and I am speaking to the customer now
              </label>
              <button type="button" className="btn-primary min-h-12" disabled={!called || make.isPending} onClick={() => make.mutate()}>
                Make a recovery code
              </button>
            </>
          )}
          {make.isError && <p role="alert" className="text-red-700">{errText(make.error)}</p>}
        </div>
      )}

      {d.recoveryCodes.length > 0 && (
        <div className="text-sm">
          <h4 className="font-semibold">Recent recovery codes</h4>
          <ul className="text-gray-700">
            {d.recoveryCodes.map((c) => (
              <li key={c.createdAt}>
                {fmtWhen(c.createdAt)} ·{' '}
                {c.usedAt ? `used ${fmtWhen(c.usedAt)}` : `not used · valid until ${fmtWhen(c.expiresAt)}`}
                {c.wrongTries ? ` · ${c.wrongTries} wrong ${c.wrongTries === 1 ? 'try' : 'tries'}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
