// frontend/src/pages/MySalons.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MySalons from './MySalons';
import { renderPage } from '../test/utils';
import { saveMySalon, getMySalons } from '../lib/mySalons';
import { saveTicket } from '../lib/activeTickets';
import * as salons from '../api/salons';
import type { PublicQueue } from '../api/salons';
import { resetLangForTests } from '../lib/i18n';

vi.mock('../api/salons', () => ({ fetchPublicQueue: vi.fn() }));

const queue = (salonId: string, over: Partial<PublicQueue> = {}): PublicQueue => ({
  salonId, name: salonId === 's1' ? 'Milan Hair Salon' : 'Second Salon', isOpen: true, isPaused: false,
  allowAppJoin: true, nowServingToken: 5, waitingCount: 2, estimatedWaitMinutes: 15, lanes: null, ...over,
});
const renderList = () => renderPage(<MySalons />, { path: '/c', route: '/c' });

beforeEach(() => {
  vi.mocked(salons.fetchPublicQueue).mockReset().mockImplementation(async (id: string) => queue(id));
});

afterEach(() => {
  localStorage.removeItem('svq.lang.v1');
  resetLangForTests();
});

describe('MySalons (customer app home)', () => {
  it('with nothing scanned yet, explains how a salon gets here', async () => {
    renderList();
    expect(await screen.findByText('अभी कोई सैलून नहीं')).toBeInTheDocument();
    expect(screen.getByText(/QR कोड स्कैन करें/)).toBeInTheDocument();
    expect(salons.fetchPublicQueue).not.toHaveBeenCalled();
  });

  it('lists every scanned salon, newest first, with its live line', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    saveMySalon({ salonId: 's1', code: 'aaaaaaaaaaaa', name: 'Milan Hair Salon' });
    vi.setSystemTime(2000);
    saveMySalon({ salonId: 's2', code: 'bbbbbbbbbbbb', name: 'Second Salon' });
    vi.useRealTimers();
    vi.mocked(salons.fetchPublicQueue).mockImplementation(async (id: string) =>
      id === 's1' ? queue(id, { isOpen: false }) : queue(id),
    );
    renderList();

    const links = await screen.findAllByRole('link', { name: /Salon/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/c/s/bbbbbbbbbbbb', '/c/s/aaaaaaaaaaaa']);
    expect(await screen.findByText(/अभी #5 · 2 लोग इंतज़ार में/)).toBeInTheDocument();
    expect(await screen.findByText('अभी बंद है')).toBeInTheDocument();
  });

  it('links straight to this phone\'s ticket at a salon', async () => {
    saveMySalon({ salonId: 's1', code: 'aaaaaaaaaaaa', name: 'Milan Hair Salon' });
    saveTicket({ ticketId: 't-9', accessToken: 'x'.repeat(40), salonId: 's1', tokenNumber: 9 });
    renderList();
    const link = await screen.findByRole('link', { name: 'आपका टोकन #9' });
    expect(link.getAttribute('href')).toMatch(/^\/tickets\/t-9\?accessToken=/);
  });

  it('removes a salon only after a second tap', async () => {
    saveMySalon({ salonId: 's1', code: 'aaaaaaaaaaaa', name: 'Milan Hair Salon' });
    const user = userEvent.setup();
    renderList();

    const card = (await screen.findByText('Milan Hair Salon')).closest('li')!;
    await user.click(within(card).getByRole('button', { name: 'हटाएँ' }));
    expect(getMySalons()).toHaveLength(1);
    await user.click(within(card).getByRole('button', { name: 'हाँ, हटाएँ' }));
    expect(getMySalons()).toHaveLength(0);
    expect(await screen.findByText('अभी कोई सैलून नहीं')).toBeInTheDocument();
  });

  it('a salon that cannot be loaded says so instead of breaking the list', async () => {
    saveMySalon({ salonId: 's1', code: 'aaaaaaaaaaaa', name: 'Milan Hair Salon' });
    vi.mocked(salons.fetchPublicQueue).mockRejectedValue(new Error('down'));
    renderList();
    expect(await screen.findByText('अभी उपलब्ध नहीं')).toBeInTheDocument();
    expect(screen.getByText('Milan Hair Salon')).toBeInTheDocument();
  });
});

describe('MySalons in English', () => {
  it('switches the page and the cards to English', async () => {
    saveMySalon({ salonId: 's1', code: 'aaaaaaaaaaaa', name: 'Milan Hair Salon' });
    const user = userEvent.setup();
    renderList();
    await screen.findByText(/अभी #5/);
    await user.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByRole('heading', { name: 'My salons' })).toBeInTheDocument();
    expect(await screen.findByText(/Now #5 · 2 waiting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});