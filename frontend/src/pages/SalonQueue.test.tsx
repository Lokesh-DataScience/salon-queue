// frontend/src/pages/SalonQueue.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SalonQueue from './SalonQueue';
import { renderPage } from '../test/utils';
import { socket, resetSocket, fireSocket } from '../test/fakeSocket';
import { ApiError } from '../api/client';
import { saveTicket } from '../lib/activeTickets';
import { getMySalons } from '../lib/mySalons';
import * as salons from '../api/salons';
import type { PublicQueue } from '../api/salons';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn(), fetchPublicQueue: vi.fn() }));

const CODE = 'abcdef123456';
const queue = (over: Partial<PublicQueue> = {}): PublicQueue => ({
  salonId: 'salon-1', name: 'Milan Hair Salon', isOpen: true, isPaused: false, allowAppJoin: true,
  nowServingToken: 7, waitingCount: 3, estimatedWaitMinutes: 25, lanes: null, ...over,
});
const given = (over: Partial<PublicQueue> = {}) => vi.mocked(salons.fetchPublicQueue).mockResolvedValue(queue(over));
// The three number tiles: "Now serving", "Waiting", "min wait".
const tile = (label: string) => screen.getByRole('group', { name: label });
const renderQueue = () => renderPage(<SalonQueue />, { path: '/c/s/:code', route: `/c/s/${CODE}` });

beforeEach(() => {
  resetSocket();
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue({ id: 'salon-1', name: 'Milan Hair Salon' });
  vi.mocked(salons.fetchPublicQueue).mockReset();
});

describe('SalonQueue (customer app)', () => {
  it('shows who is being served, how many wait and the wait, and offers to join from home', async () => {
    given();
    renderQueue();

    expect(await screen.findByRole('heading', { name: 'Milan Hair Salon' })).toBeInTheDocument();
    expect(tile('अभी चल रहा')).toHaveTextContent('#7');
    expect(tile('इंतज़ार में')).toHaveTextContent('3');
    expect(tile('मिनट इंतज़ार')).toHaveTextContent('~25');
    expect(screen.getByText('खुला है')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'घर बैठे टोकन लें' })).toHaveAttribute('href', `/c/s/${CODE}/join`);
    await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('join:salon', { salonId: 'salon-1' }));
  });

  it('updates live when the salon room says something changed', async () => {
    given();
    renderQueue();
    await screen.findByRole('heading', { name: 'Milan Hair Salon' });
    expect(tile('इंतज़ार में')).toHaveTextContent('3');

    given({ waitingCount: 2, nowServingToken: 8 });
    act(() => fireSocket('queue:updated', { salonId: 'salon-1' }));
    await waitFor(() => expect(tile('इंतज़ार में')).toHaveTextContent('2'));
    expect(tile('अभी चल रहा')).toHaveTextContent('#8');
  });

  it('cannot join when the barber switched app tokens off, and says why', async () => {
    given({ allowAppJoin: false });
    renderQueue();

    expect(await screen.findByRole('button', { name: 'घर बैठे टोकन लें' })).toBeDisabled();
    expect(screen.getByText(/ऐप से टोकन बंद है/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'घर बैठे टोकन लें' })).not.toBeInTheDocument();
  });

  it('cannot join while the salon is closed or paused', async () => {
    given({ isOpen: false });
    renderQueue();
    expect(await screen.findByText('सैलून अभी बंद है।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'घर बैठे टोकन लें' })).toBeDisabled();
  });

  it('a phone that already has a ticket here sees "my token" instead of join', async () => {
    saveTicket({ ticketId: 't-1', accessToken: 'x'.repeat(40), salonId: 'salon-1', tokenNumber: 4 });
    given();
    renderQueue();

    const link = await screen.findByRole('link', { name: 'मेरा टोकन देखें #4' });
    expect(link.getAttribute('href')).toMatch(/^\/tickets\/t-1\?accessToken=/);
    expect(screen.queryByRole('link', { name: 'घर बैठे टोकन लें' })).not.toBeInTheDocument();
  });

  it('lists the barbers when there is a choice', async () => {
    given({
      lanes: [
        { id: 'l1', name: 'Main', waitingCount: 2, estimatedWaitMinutes: 20, isPaused: false },
        { id: 'l2', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 10, isPaused: true },
      ],
    });
    renderQueue();
    expect(await screen.findByText('Rahul')).toBeInTheDocument();
    expect(screen.getByText('ब्रेक पर')).toBeInTheDocument();
    expect(screen.getByText('2 इंतज़ार में · ~20 मिनट')).toBeInTheDocument();
  });

  it('keeps the salon in "My salons"', async () => {
    given();
    renderQueue();
    await screen.findByRole('heading', { name: 'Milan Hair Salon' });
    expect(getMySalons().map((s) => s.code)).toEqual([CODE]);
  });

  it('an unknown QR code shows a clear Hindi message and no retry', async () => {
    vi.mocked(salons.fetchSalonByCode).mockRejectedValue(new ApiError('This QR code is not recognised.', 404));
    renderQueue();
    expect(await screen.findByRole('alert')).toHaveTextContent('यह QR कोड पहचाना नहीं गया');
    expect(screen.queryByRole('button', { name: 'फिर से कोशिश करें' })).not.toBeInTheDocument();
  });

  it('a network failure offers a retry that works', async () => {
    vi.mocked(salons.fetchSalonByCode)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ id: 'salon-1', name: 'Milan Hair Salon' });
    given();
    renderQueue();

    await userEvent.click(await screen.findByRole('button', { name: 'फिर से कोशिश करें' }));
    await screen.findByRole('heading', { name: 'Milan Hair Salon' });
    expect(tile('इंतज़ार में')).toHaveTextContent('3');
  });

  it('shows the heading only after the queue has loaded', async () => {
    let finish: (q: PublicQueue) => void = () => {};
    vi.mocked(salons.fetchPublicQueue).mockReturnValue(new Promise((r) => (finish = r)));
    renderQueue();
    expect(await screen.findByRole('heading', { name: 'सैलून की लाइन' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('लाइन देख रहे हैं');
    act(() => finish(queue()));
    expect(await screen.findByRole('heading', { name: 'Milan Hair Salon' })).toBeInTheDocument();
  });

  it('says so when nobody is waiting', async () => {
    given({ waitingCount: 0, estimatedWaitMinutes: 0 });
    renderQueue();
    expect(await screen.findByText(/कोई इंतज़ार में नहीं/)).toBeInTheDocument();
    expect(within(tile('इंतज़ार में')).getByText('0')).toBeInTheDocument();
  });
});