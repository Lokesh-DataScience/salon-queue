// frontend/src/hooks/useActiveTickets.ts
import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { fetchTicketStatus } from '../api/tickets';
import { ApiError } from '../api/client';
import { getTickets, removeTicket, type StoredTicket } from '../lib/activeTickets';
import { getMySalons } from '../lib/mySalons';
import { recordVisit } from '../lib/visitHistory';

const FINISHED = ['COMPLETED', 'SKIPPED', 'CANCELLED'];

export interface ActiveTicket {
  stored: StoredTicket;
  ticket: any | null; // null when the server couldn't be reached to verify
}

// Returns only tickets the server confirms are still active, and prunes dead ones from storage.
export function useActiveTickets(salonId?: string) {
  const stored = useMemo(() => getTickets(salonId), [salonId]);

  const results = useQueries({
    queries: stored.map((t) => ({
      queryKey: ['ticket', t.ticketId], // same key as QueueTracking, so the cache is shared
      queryFn: () => fetchTicketStatus(t.ticketId, t.accessToken),
      retry: false,
      staleTime: 15_000,
    })),
  });

  const isDead = (q: (typeof results)[number]) =>
    (q.error instanceof ApiError && q.error.status === 404) ||
    (!!q.data && FINISHED.includes(q.data.status));

  const signature = results.map((q) => `${q.status}:${q.data?.status ?? ''}`).join('|');
  useEffect(() => {
    stored.forEach((t, i) => {
      const q = results[i];
      if (!q || !isDead(q)) return;
      // Finished while the ticket page was closed: still goes into the visit history.
      if (q.data) {
        recordVisit({
          ticketId: t.ticketId,
          salonId: t.salonId,
          salonName: q.data.salonName ?? getMySalons().find((s) => s.salonId === t.salonId)?.name,
          salonCode: q.data.salonCode,
          tokenNumber: t.tokenNumber,
          status: q.data.status,
        });
      }
      removeTicket(t.ticketId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const tickets: ActiveTicket[] = [];
  let isChecking = false;
  stored.forEach((s, i) => {
    const q = results[i];
    if (!q || q.isPending) {
      isChecking = true;
      return;
    }
    if (isDead(q)) return;
    // A network error is not proof the ticket is gone, so keep showing it.
    tickets.push({ stored: s, ticket: q.data ?? null });
  });

  return { tickets, isChecking };
}