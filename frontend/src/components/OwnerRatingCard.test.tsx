import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import OwnerRatingCard from './OwnerRatingCard';
import { renderPage } from '../test/utils';
import * as ratings from '../api/ratings';

vi.mock('../api/ratings', () => ({ fetchOwnerRating: vi.fn() }));

const stats = (over: Partial<ratings.OwnerRating> = {}): ratings.OwnerRating => ({
  count: 3,
  average: 4.3,
  byStars: { '1': 0, '2': 0, '3': 0, '4': 2, '5': 1 },
  minPublic: 5,
  publiclyVisible: false,
  ...over,
});

beforeEach(() => vi.mocked(ratings.fetchOwnerRating).mockReset());

describe('OwnerRatingCard', () => {
  it('shows the average, the count and the breakdown, and when customers will see it', async () => {
    vi.mocked(ratings.fetchOwnerRating).mockResolvedValue(stats());
    renderPage(<OwnerRatingCard />);
    expect(await screen.findByText(/4\.3/)).toHaveTextContent('from 3 ratings');
    const rows = within(screen.getByRole('list', { name: 'Ratings by stars' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('5★1');
    expect(rows[1]).toHaveTextContent('4★2');
    expect(screen.getByText('Customers will see your rating once you have 5 ratings.')).toBeInTheDocument();
  });

  it('says when the rating is public', async () => {
    vi.mocked(ratings.fetchOwnerRating).mockResolvedValue(stats({ count: 6, publiclyVisible: true }));
    renderPage(<OwnerRatingCard />);
    expect(await screen.findByText(/Customers see this rating/)).toBeInTheDocument();
  });

  it('with no ratings yet, explains where they come from', async () => {
    vi.mocked(ratings.fetchOwnerRating).mockResolvedValue(
      stats({ count: 0, average: null, byStars: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } }),
    );
    renderPage(<OwnerRatingCard />);
    expect(await screen.findByText(/No ratings yet/)).toBeInTheDocument();
  });
});
