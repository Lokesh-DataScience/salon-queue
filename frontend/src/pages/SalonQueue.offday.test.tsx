// frontend/src/pages/SalonQueue.offday.test.tsx — Weekly off day, Slice 2: the customer app's salon page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import SalonQueue from './SalonQueue';
import { renderPage } from '../test/utils';
import { resetSocket } from '../test/fakeSocket';
import { resetLangForTests, setLang } from '../lib/i18n';
import * as salons from '../api/salons';
import * as publicServices from '../api/publicServices';
import type { PublicQueue } from '../api/salons';

vi.mock('../lib/socket', () => import('../test/fakeSocket'));
vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn(), fetchPublicQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn() }));

const CODE = 'abcdef123456';
const queue = (over: Partial<PublicQueue> = {}): PublicQueue => ({
  salonId: 'salon-1', name: 'Milan Hair Salon', isOpen: true, isPaused: false, allowAppJoin: true,
  nowServingToken: 7, waitingCount: 3, estimatedWaitMinutes: 25, lanes: null,
  openingTime: '09:00', closingTime: '21:00', weeklyOffDays: [], ...over,
});
const given = (over: Partial<PublicQueue> = {}) => vi.mocked(salons.fetchPublicQueue).mockResolvedValue(queue(over));
const renderQueue = () => renderPage(<SalonQueue />, { path: '/c/s/:code', route: `/c/s/${CODE}` });

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  resetSocket();
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue({ id: 'salon-1', name: 'Milan Hair Salon' });
  vi.mocked(salons.fetchPublicQueue).mockReset();
  vi.mocked(publicServices.fetchSalonServices).mockReset().mockResolvedValue([]);
});

describe('SalonQueue on the weekly off day', () => {
  it('shows "weekly off today", disables joining and says when it is closed', async () => {
    given({ isOpen: false, isOffDay: true, weeklyOffDays: [2] });
    renderQueue();

    expect(await screen.findByRole('button', { name: 'घर बैठे टोकन लें' })).toBeDisabled();
    expect(screen.getByText('आज छुट्टी है')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('आज साप्ताहिक छुट्टी है (हर मंगलवार)');
    expect(screen.queryByRole('link', { name: 'घर बैठे टोकन लें' })).not.toBeInTheDocument();
  });

  it('on other days the info card names the off day and stops saying "daily"', async () => {
    setLang('en');
    given({ weeklyOffDays: [0, 2] });
    renderQueue();

    expect(await screen.findByRole('link', { name: 'Take a token from home' })).toBeInTheDocument();
    expect(screen.getByText('Weekly off: Tuesday and Sunday')).toBeInTheDocument();
    expect(screen.getByText(/^Open 9:00 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/^Daily/)).not.toBeInTheDocument();
  });

  it('a salon open every day looks exactly as before', async () => {
    setLang('en');
    given();
    renderQueue();

    expect(await screen.findByText(/^Daily 9:00 AM/)).toBeInTheDocument();
    expect(screen.queryByText(/Weekly off/)).not.toBeInTheDocument();
  });
});
