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
import * as publicServices from '../api/publicServices';
import type { PublicQueue } from '../api/salons';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn(), fetchPublicQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn() }));

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
  vi.mocked(publicServices.fetchSalonServices).mockReset().mockResolvedValue([]);
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

  it('shows the salon hours, address, a map link and a call link', async () => {
    given({
      openingTime: '09:00',
      closingTime: '21:00',
      address: 'Main Road, Bilaspur',
      phone: '9876543210',
      location: { lat: 22.08, lng: 82.15 },
    });
    renderQueue();
    const info = await screen.findByRole('region', { name: 'सैलून की जानकारी' });
    expect(info).toHaveTextContent('रोज़ सुबह 9:00 – रात 9:00');
    expect(info).toHaveTextContent('Main Road, Bilaspur');
    expect(within(info).getByRole('link', { name: 'नक्शा' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=22.08,82.15',
    );
    expect(within(info).getByRole('link', { name: 'कॉल करें' })).toHaveAttribute('href', 'tel:+919876543210');
  });

  it('leaves out what the salon has not filled in', async () => {
    given({ address: null, phone: null, location: null, openingTime: null, closingTime: null });
    renderQueue();
    const info = await screen.findByRole('region', { name: 'सैलून की जानकारी' });
    expect(within(info).queryByRole('link')).not.toBeInTheDocument();
    expect(info).not.toHaveTextContent('रोज़');
  });

  it('lists the services with prices, and hides a price that is not set', async () => {
    given();
    vi.mocked(publicServices.fetchSalonServices).mockResolvedValue([
      { id: 's1', name: 'बाल कटिंग', durationMinutes: 30, priceRupees: 100 },
      { id: 's2', name: 'दाढ़ी', durationMinutes: 15, priceRupees: null },
    ]);
    renderQueue();
    const list = await screen.findByRole('region', { name: 'सेवाएँ और रेट' });
    expect(within(list).getByText('बाल कटिंग').closest('li')).toHaveTextContent('30 मिनट₹100');
    expect(within(list).getByText('दाढ़ी').closest('li')).not.toHaveTextContent('₹');
    expect(list).toHaveTextContent('पक्का रेट सैलून में पूछें');
  });

  it('shows no services card for a salon without services', async () => {
    given();
    renderQueue();
    await screen.findByRole('heading', { name: 'Milan Hair Salon' });
    await waitFor(() => expect(publicServices.fetchSalonServices).toHaveBeenCalledWith('salon-1'));
    expect(screen.queryByRole('region', { name: 'सेवाएँ और रेट' })).not.toBeInTheDocument();
  });

  it('pins the salon to the top of "My salons"', async () => {
    given();
    renderQueue();
    const pin = await screen.findByRole('button', { name: 'ऊपर पिन करें' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(pin);
    expect(screen.getByRole('button', { name: 'पिन हटाएँ' })).toHaveAttribute('aria-pressed', 'true');
    expect(getMySalons()[0]).toMatchObject({ code: CODE, pinned: true });
  });

  it('shows the salon rating once it has 5 ratings', async () => {
    given({ rating: { average: 4.25, count: 12 } });
    renderQueue();
    const info = await screen.findByRole('region', { name: 'सैलून की जानकारी' });
    expect(info).toHaveTextContent('4.3 · 12 रेटिंग');
    expect(info).toHaveTextContent('12 ग्राहकों की औसत रेटिंग: 5 में से 4.3');
  });

  it('shows no rating when there are fewer than 5', async () => {
    given({ rating: null });
    renderQueue();
    const info = await screen.findByRole('region', { name: 'सैलून की जानकारी' });
    expect(info).not.toHaveTextContent('रेटिंग');
  });
});
