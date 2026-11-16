// frontend/src/components/admin/shop/ShopStockCheck.tsx — the daily stock check (D4).
// Pre-filled with today's numbers; change only what differs and save once. All or nothing: if any row
// changed since the page loaded, nothing is saved and the list reloads.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchShopProducts, submitStockCheck, type ShopProduct } from '../../../api/shopAdmin';

export default function ShopStockCheck({ readOnly }: { readOnly: boolean }) {
  const products = useQuery({ queryKey: ['shopProducts', '', ''], queryFn: () => fetchShopProducts() });
  const [result, setResult] = useState<string | null>(null);

  if (products.isLoading) return <p role="status" className="text-gray-600">Loading...</p>;
  if (products.isError) return <p role="alert" className="text-red-600">Couldn't load products. Please try again.</p>;
  if (!products.data?.length) return <p className="card text-gray-600">No products yet.</p>;
  // A new key (fresh numbers) starts a fresh form, pre-filled with the current stock.
  const key = products.data.map((p) => `${p.id}:${p.stockOnHand}`).join(',');
  return <CheckForm key={key} products={products.data} readOnly={readOnly} result={result} setResult={setResult} />;
}

function CheckForm({
  products,
  readOnly,
  result,
  setResult,
}: {
  products: ShopProduct[];
  readOnly: boolean;
  result: string | null;
  setResult: (r: string | null) => void;
}) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(products.map((p) => [p.id, String(p.stockOnHand)])),
  );

  const invalid = useMemo(() => Object.values(counts).some((v) => !/^\d+$/.test(v.trim())), [counts]);
  const changed = products.filter((p) => counts[p.id] !== undefined && Number(counts[p.id]) !== p.stockOnHand).length;

  const save = useMutation({
    mutationFn: () =>
      submitStockCheck(
        products.map((p) => ({ productId: p.id, counted: Number(counts[p.id]), expectedOnHand: p.stockOnHand })),
      ),
    onSuccess: async (r) => {
      setResult(`Saved. ${r.checked} products checked, ${r.changed} changed.`);
      await qc.invalidateQueries({ queryKey: ['shopProducts'] });
      await qc.invalidateQueries({ queryKey: ['shopProduct'] });
      await qc.invalidateQueries({ queryKey: ['shopMovements'] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['shopProducts'] }),
  });

  return (
    <form
      className="grid gap-3"
      aria-label="Daily stock check"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        save.mutate();
      }}
    >
      <p className="text-sm text-gray-700">
        Check with the supplier, then correct any number that is different. Reserved units belong to open orders.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th scope="col" className="py-2 pr-2">Product</th>
              <th scope="col" className="py-2 pr-2 text-right">Now</th>
              <th scope="col" className="py-2 pr-2 text-right">Reserved</th>
              <th scope="col" className="py-2 text-right">Counted</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const differs = counts[p.id] !== undefined && Number(counts[p.id]) !== p.stockOnHand;
              return (
                <tr key={p.id} className="border-t">
                  <th scope="row" className="py-2 pr-2 text-left font-medium">
                    {p.name}
                    <span className="block text-xs font-normal text-gray-600">{p.sku}</span>
                  </th>
                  <td className="py-2 pr-2 text-right">{p.stockOnHand}</td>
                  <td className="py-2 pr-2 text-right">{p.stockReserved}</td>
                  <td className="py-2 text-right">
                    {readOnly ? (
                      p.stockOnHand
                    ) : (
                      <input
                        aria-label={`Counted units of ${p.name}`}
                        className={`field w-24 text-right ${differs ? 'border-ink font-bold' : ''}`}
                        inputMode="numeric"
                        value={counts[p.id] ?? ''}
                        onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <>
          {invalid && <p role="alert" className="text-sm text-red-700">Every count must be a whole number (0 or more).</p>}
          {save.isError && (
            <p role="alert" className="text-sm text-red-700">
              {save.error instanceof Error ? save.error.message : 'Something went wrong.'} The list has been reloaded; nothing was saved.
            </p>
          )}
          {result && <p role="status" className="text-sm font-semibold text-green-800">{result}</p>}
          <button type="submit" className="btn-primary min-h-12" disabled={invalid || save.isPending}>
            {save.isPending ? 'Saving...' : changed ? `Save check (${changed} changed)` : 'Save check (no changes)'}
          </button>
        </>
      )}
    </form>
  );
}
