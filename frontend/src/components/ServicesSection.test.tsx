// frontend/src/components/ServicesSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServicesSection from './ServicesSection';
import { renderPage } from '../test/utils';
import * as barber from '../api/barber';

vi.mock('../api/barber', () => ({
  fetchBarberServices: vi.fn(),
  addBarberService: vi.fn(),
  removeBarberService: vi.fn(),
}));

const renderSection = () => renderPage(<ServicesSection />, { path: '/x', route: '/x' });

beforeEach(() => {
  vi.mocked(barber.fetchBarberServices).mockReset().mockResolvedValue([
    { id: 's1', name: 'hair cutting' },
    { id: 's2', name: 'beard trimming' },
  ]);
  vi.mocked(barber.addBarberService).mockReset();
  vi.mocked(barber.removeBarberService).mockReset();
});

describe('ServicesSection', () => {
  it('lists the saved services', async () => {
    renderSection();
    expect(await screen.findByText('hair cutting')).toBeInTheDocument();
    expect(screen.getByText('beard trimming')).toBeInTheDocument();
  });

  it('adds a tidied service and shows it', async () => {
    vi.mocked(barber.addBarberService).mockResolvedValue({ id: 's3', name: 'head massage' });
    const user = userEvent.setup();
    renderSection();

    await user.type(await screen.findByLabelText('Add a service'), '  head   massage ');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(barber.addBarberService).toHaveBeenCalledWith('head massage');
    expect(await screen.findByText('head massage')).toBeInTheDocument();
    expect(screen.getByLabelText('Add a service')).toHaveValue('');
  });

  it('removes a service', async () => {
    vi.mocked(barber.removeBarberService).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Remove hair cutting' }));

    expect(barber.removeBarberService).toHaveBeenCalledWith('s1');
    await vi.waitFor(() => expect(screen.queryByText('hair cutting')).not.toBeInTheDocument());
    expect(screen.getByText('beard trimming')).toBeInTheDocument();
  });

  it('rejects a duplicate (any letter case) without calling the API', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.type(await screen.findByLabelText('Add a service'), 'Hair Cutting');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already in your list');
    expect(barber.addBarberService).not.toHaveBeenCalled();
  });

  it('explains that an empty list means instant join', async () => {
    vi.mocked(barber.fetchBarberServices).mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText(/join the queue instantly/i)).toBeInTheDocument();
  });

  it('shows the server error and stays usable', async () => {
    vi.mocked(barber.addBarberService).mockRejectedValue(new Error('You can add up to 12 services.'));
    const user = userEvent.setup();
    renderSection();

    await user.type(await screen.findByLabelText('Add a service'), 'scrub');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('up to 12');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });
});