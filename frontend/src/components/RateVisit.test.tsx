import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RateVisit from './RateVisit';
import { renderPage } from '../test/utils';
import { resetLangForTests } from '../lib/i18n';
import * as ratings from '../api/ratings';

vi.mock('../api/ratings', () => ({ fetchMyRating: vi.fn(), rateVisit: vi.fn() }));

const TOKEN = 'a'.repeat(40);
const renderRate = () => renderPage(<RateVisit ticketId="t1" accessToken={TOKEN} />);

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  vi.mocked(ratings.fetchMyRating).mockReset();
  vi.mocked(ratings.rateVisit).mockReset().mockImplementation(async (_id, _tok, stars) => ({ stars }));
});

describe('RateVisit', () => {
  it('asks in Hindi and saves one tap', async () => {
    vi.mocked(ratings.fetchMyRating).mockResolvedValue({ stars: null, canRate: true });
    const user = userEvent.setup();
    renderRate();
    expect(await screen.findByRole('heading', { name: 'आपकी सेवा कैसी रही?' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);

    await user.click(screen.getByRole('radio', { name: '4 स्टार' }));
    expect(ratings.rateVisit).toHaveBeenCalledWith('t1', TOKEN, 4);
    expect(await screen.findByText(/आपने 4 स्टार दिए/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '4 स्टार' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows an earlier rating and lets the customer change it', async () => {
    vi.mocked(ratings.fetchMyRating).mockResolvedValue({ stars: 2, canRate: true });
    const user = userEvent.setup();
    renderRate();
    expect(await screen.findByRole('radio', { name: '2 स्टार' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: '5 स्टार' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: '5 स्टार' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('shows nothing when the visit can no longer be rated', async () => {
    vi.mocked(ratings.fetchMyRating).mockResolvedValue({ stars: null, canRate: false });
    const { container } = renderRate();
    await waitFor(() => expect(ratings.fetchMyRating).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing if the rating check fails', async () => {
    vi.mocked(ratings.fetchMyRating).mockRejectedValue(new Error('down'));
    const { container } = renderRate();
    await waitFor(() => expect(ratings.fetchMyRating).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('says so when saving fails', async () => {
    vi.mocked(ratings.fetchMyRating).mockResolvedValue({ stars: null, canRate: true });
    vi.mocked(ratings.rateVisit).mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    renderRate();
    await user.click(await screen.findByRole('radio', { name: '3 स्टार' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('रेटिंग सेव नहीं हुई');
  });
});
