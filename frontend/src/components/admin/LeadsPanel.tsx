// frontend/src/components/admin/LeadsPanel.tsx
// Sales → Leads: salons being talked to before they register. Follow-ups due today come first.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createLead,
  deleteLead,
  fetchLeads,
  fetchSalesActivity,
  updateLead,
  type Lead,
  type LeadInput,
  type LeadStatus,
} from '../../api/admin';

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  demo: 'Demo given',
  interested: 'Interested',
  not_interested: 'Not interested',
  converted: 'Signed up',
};
const CLOSED: LeadStatus[] = ['converted', 'not_interested'];

type Filter = 'due' | 'open' | 'all' | 'converted';
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');

function fmtDay(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const isDue = (l: Lead, today: string) => !!l.followUpOn && l.followUpOn <= today && !CLOSED.includes(l.status);

function LeadForm({ lead, onDone }: { lead?: Lead; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: lead?.name ?? '',
    ownerName: lead?.ownerName ?? '',
    phone: lead?.phone ?? '',
    area: lead?.area ?? '',
    address: lead?.address ?? '',
    status: (lead?.status ?? 'new') as LeadStatus,
    followUpOn: lead?.followUpOn ?? '',
    notes: lead?.notes ?? '',
    salonId: lead?.salonId ?? '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Registered salons to link to, only needed once the lead has signed up.
  const salons = useQuery({
    queryKey: ['salesActivity'],
    queryFn: fetchSalesActivity,
    enabled: f.status === 'converted',
    retry: false,
  });

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['salesLeads'] });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => {
      const input: LeadInput & { name: string } = {
        ...f,
        followUpOn: f.followUpOn || null,
        salonId: f.status === 'converted' && f.salonId ? f.salonId : null,
      };
      return lead ? updateLead(lead.id, input) : createLead(input);
    },
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => deleteLead(lead!.id), onSuccess: done });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const id = (k: string) => `lead-${lead?.id ?? 'new'}-${k}`;

  return (
    <form
      className="grid gap-3"
      aria-label={lead ? `Edit lead ${lead.name}` : 'New lead'}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {([
        ['name', 'Salon name', 'text'],
        ['ownerName', "Owner's name", 'text'],
        ['phone', 'Phone', 'tel'],
        ['area', 'Area', 'text'],
        ['address', 'Address', 'text'],
      ] as const).map(([k, label, type]) => (
        <div key={k}>
          <label htmlFor={id(k)} className="mb-1 block text-sm font-medium">{label}</label>
          <input id={id(k)} className="field" type={type} required={k === 'name'} autoComplete="off"
            value={f[k]} onChange={set(k)} />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('status')} className="mb-1 block text-sm font-medium">Status</label>
          <select id={id('status')} className="field" value={f.status} onChange={set('status')}>
            {(Object.keys(STATUS_LABEL) as LeadStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={id('follow')} className="mb-1 block text-sm font-medium">Follow up on</label>
          <input id={id('follow')} className="field" type="date" value={f.followUpOn} onChange={set('followUpOn')} />
        </div>
      </div>
      {f.status === 'converted' && (
        <div>
          <label htmlFor={id('salon')} className="mb-1 block text-sm font-medium">Their registered salon (optional)</label>
          <select id={id('salon')} className="field" value={f.salonId} onChange={set('salonId')}>
            <option value="">Not linked</option>
            {(salons.data?.salons ?? [])
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((s) => <option key={s.id} value={s.id}>{s.name} — {s.area}</option>)}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={id('notes')} className="mb-1 block text-sm font-medium">Notes</label>
        <textarea id={id('notes')} className="field min-h-20" maxLength={2000} value={f.notes} onChange={set('notes')} />
      </div>

      {save.isError && <p role="alert" className="text-sm text-red-700">{errText(save.error)}</p>}
      {remove.isError && <p role="alert" className="text-sm text-red-700">{errText(remove.error)}</p>}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 flex-1" disabled={save.isPending}>
          {save.isPending ? 'Saving...' : lead ? 'Save' : 'Add lead'}
        </button>
        <button type="button" className="btn-secondary min-h-11 px-4" onClick={onDone}>Cancel</button>
      </div>
      {lead &&
        (confirmDelete ? (
          <div className="flex gap-2">
            <button type="button" className="btn-primary min-h-11 flex-1 bg-red-700" disabled={remove.isPending}
              onClick={() => remove.mutate()}>
              {remove.isPending ? 'Deleting...' : 'Yes, delete this lead'}
            </button>
            <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => setConfirmDelete(false)}>Keep</button>
          </div>
        ) : (
          <button type="button" className="justify-self-start text-sm font-semibold text-red-700 underline"
            onClick={() => setConfirmDelete(true)}>
            Delete lead
          </button>
        ))}
    </form>
  );
}

function LeadCard({ l, today }: { l: Lead; today: string }) {
  const [editing, setEditing] = useState(false);
  const due = isDue(l, today);
  return (
    <li className="py-4">
      {editing ? (
        <LeadForm lead={l} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold">{l.name}</h4>
            <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-800">
              {STATUS_LABEL[l.status]}
            </span>
            {due && (
              <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-900">
                Follow up {l.followUpOn! < today ? 'overdue' : 'today'}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-700">
            {[l.ownerName, l.area].filter(Boolean).join(' · ')}
            {l.phone && (
              <>
                {l.ownerName || l.area ? ' · ' : ''}
                <a className="underline" href={`tel:${l.phone}`}>{l.phone}</a>
              </>
            )}
          </p>
          {l.followUpOn && !due && <p className="text-sm text-gray-600">Follow up {fmtDay(l.followUpOn)}</p>}
          {l.salonName && <p className="text-sm text-gray-600">Registered as {l.salonName}</p>}
          {l.notes && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-sm">{l.notes}</p>}
          <button type="button" className="btn-secondary mt-2 min-h-11 px-3 text-sm" onClick={() => setEditing(true)}
            aria-label={`Edit lead ${l.name}`}>
            Edit
          </button>
        </>
      )}
    </li>
  );
}

export default function LeadsPanel() {
  const [filter, setFilter] = useState<Filter>('due');
  const [adding, setAdding] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['salesLeads'], queryFn: fetchLeads, retry: false });

  if (isLoading) return <p role="status" className="text-gray-600">Loading leads...</p>;
  if (!data) {
    return (
      <div className="card text-center">
        <p role="alert" className="mb-3 text-red-700">Couldn't load leads.</p>
        <button type="button" className="btn-secondary" onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  const { leads, today } = data;
  const dueCount = leads.filter((l) => isDue(l, today)).length;
  const openCount = leads.filter((l) => !CLOSED.includes(l.status)).length;
  const convertedCount = leads.filter((l) => l.status === 'converted').length;
  const shown = leads.filter((l) =>
    filter === 'due' ? isDue(l, today)
    : filter === 'open' ? !CLOSED.includes(l.status)
    : filter === 'converted' ? l.status === 'converted'
    : true,
  );
  const filters: { id: Filter; label: string }[] = [
    { id: 'due', label: `Follow up today (${dueCount})` },
    { id: 'open', label: `Open (${openCount})` },
    { id: 'converted', label: `Signed up (${convertedCount})` },
    { id: 'all', label: `All (${leads.length})` },
  ];

  return (
    <div className="grid gap-4">
      {isError && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-center text-sm text-amber-900">
          Couldn't refresh. Showing the last list.
        </p>
      )}
      {adding ? (
        <div className="card"><LeadForm onDone={() => setAdding(false)} /></div>
      ) : (
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add a lead</button>
      )}

      <div role="group" aria-label="Show" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {filters.map((x) => (
          <button key={x.id} type="button" aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}
            className={`min-h-11 rounded-xl px-2 text-sm ${
              filter === x.id ? 'border-4 border-ink bg-brand font-bold text-ink' : 'border-2 border-gray-300 bg-white font-medium text-gray-700'
            }`}>
            {x.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-gray-600">
          {filter === 'due' ? 'No follow-ups due today.' : leads.length === 0 ? 'No leads yet. Add the first one.' : 'Nothing here.'}
        </p>
      ) : (
        <ul aria-label="Leads" className="card divide-y divide-gray-200 py-0">
          {shown.map((l) => <LeadCard key={l.id} l={l} today={today} />)}
        </ul>
      )}
    </div>
  );
}
