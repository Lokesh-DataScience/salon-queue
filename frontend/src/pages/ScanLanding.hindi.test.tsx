// frontend/src/pages/ScanLanding.hindi.test.tsx
// Customer app polish 3b: the join screens speak Hindi by default, and switch to English.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanLanding from './ScanLanding';
import { renderPage } from '../test/utils';
import { resetLangForTests } from '../lib/i18n';
import { saveRememberToken } from '../lib/rememberToken';
import { ApiError } from '../api/client';
import * as salons from '../api/salons';
import * as tickets from '../api/tickets';
import * as services from '../api/publicServices';

vi.mock('../api/salons', () => ({ fetchSalonByCode: vi.fn(), fetchSalonLanes: vi.fn() }));
vi.mock('../api/tickets', () => ({ fetchTicketStatus: vi.fn(), joinSalonQueue: vi.fn() }));
vi.mock('../api/publicServices', () => ({ fetchSalonServices: vi.fn() }));
vi.mock('../lib/push', () => ({
  askPushPermission: vi.fn().mockResolvedValue('skip'),
  enablePushAfterJoin: vi.fn(),
}));

const renderScan = (ui = <ScanLanding />) => renderPage(ui, { path: '/q/:code', route: '/q/abcdef123456' });
const known = () => saveRememberToken('s1', 'd'.repeat(64));

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  vi.mocked(salons.fetchSalonByCode).mockReset().mockResolvedValue({ id: 's1', name: 'Style Studio' });
  vi.mocked(salons.fetchSalonLanes).mockReset().mockResolvedValue([]);
  vi.mocked(services.fetchSalonServices).mockReset().mockResolvedValue([]);
  vi.mocked(tickets.fetchTicketStatus).mockReset();
  vi.mocked(tickets.joinSalonQueue).mockReset();
});

describe('first visit, in Hindi', () => {
  it('asks for name, number and consent in Hindi', async () => {
    renderScan();
    expect(await screen.findByRole('heading', { name: 'आपकी जानकारी' })).toBeInTheDocument();
    expect(screen.getByText('Style Studio')).toBeInTheDocument();
    expect(screen.getByLabelText('आपका नाम')).toBeInTheDocument();
    expect(screen.getByLabelText('मोबाइल नंबर')).toBeInTheDocument();
    expect(screen.getByLabelText('Style Studio मेरा नाम और नंबर अपनी ग्राहक सूची में सेव करेगा।')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'मेरा टोकन लें' })).toBeDisabled();
    expect(screen.getByText('अभी चाहिए: आपका नाम, 10 अंकों का मोबाइल नंबर, टिक बॉक्स।')).toBeInTheDocument();
  });

  it('a phone problem is explained in Hindi', async () => {
    const user = userEvent.setup();
    renderScan();
    await user.type(await screen.findByLabelText('मोबाइल नंबर'), '123');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('10 अंकों का सही मोबाइल नंबर डालें।');
  });

  it('a refused consent comes back in Hindi', async () => {
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('Please tick the box to continue.', 400, undefined, 'CONSENT_REQUIRED'),
    );
    const user = userEvent.setup();
    renderScan();
    await user.type(await screen.findByLabelText('आपका नाम'), 'Ravi');
    await user.type(screen.getByLabelText('मोबाइल नंबर'), '9876543210');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'मेरा टोकन लें' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('कृपया टिक बॉक्स पर निशान लगाएँ');
  });
});

describe('choosing, in Hindi', () => {
  it('the service picker speaks Hindi, with prices', async () => {
    known();
    vi.mocked(services.fetchSalonServices).mockResolvedValue([
      { id: 'c1', name: 'बाल कटिंग', durationMinutes: 20, priceRupees: 100 },
      { id: 'c2', name: 'दाढ़ी', durationMinutes: 10, priceRupees: 50 },
    ]);
    const user = userEvent.setup();
    renderScan();
    expect(await screen.findByRole('heading', { name: 'सेवा चुनें' })).toBeInTheDocument();
    expect(screen.getByText('आपको क्या करवाना है?')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('एक या ज़्यादा सेवाएँ चुनें।');
    await user.click(screen.getByRole('checkbox', { name: /बाल कटिंग/ }));
    await user.click(screen.getByRole('checkbox', { name: /दाढ़ी/ }));
    expect(screen.getByRole('status')).toHaveTextContent('2 सेवाएँ · लगभग 30 मिनट · ₹150');
    await user.click(screen.getByRole('checkbox', { name: /बाल कटिंग/ }));
    await user.click(screen.getByRole('checkbox', { name: /दाढ़ी/ }));
    await user.click(screen.getByRole('button', { name: 'मेरा टोकन लें' }));
    expect(screen.getByRole('alertdialog', { name: 'कोई सेवा नहीं चुनी' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'वापस' })).toBeInTheDocument();
  });

  it('the barber picker speaks Hindi', async () => {
    known();
    vi.mocked(salons.fetchSalonLanes).mockResolvedValue([
      { id: 'a', name: 'Owner', waitingCount: 2, estimatedWaitMinutes: 25 },
      { id: 'b', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 0, isPaused: true },
    ]);
    renderScan();
    expect(await screen.findByRole('group', { name: 'बार्बर चुनें' })).toBeInTheDocument();
    expect(screen.getByLabelText(/कोई भी बार्बर/)).toBeChecked();
    expect(screen.getByText('सबसे कम इंतज़ार · ~25 मिनट')).toBeInTheDocument();
    expect(screen.getByText('2 इंतज़ार में · ~25 मिनट')).toBeInTheDocument();
    expect(screen.getByText('ब्रेक पर')).toBeInTheDocument();
  });
});

describe('errors, in Hindi', () => {
  it('an unknown QR code', async () => {
    vi.mocked(salons.fetchSalonByCode).mockRejectedValue(new ApiError('This QR code is not recognised.', 404));
    renderScan();
    expect(await screen.findByRole('heading', { name: 'QR कोड पहचाना नहीं गया' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('QR कोड फिर से स्कैन करें');
    expect(screen.queryByRole('button', { name: 'फिर से कोशिश करें' })).not.toBeInTheDocument();
  });

  it('no internet: Hindi message and a retry button', async () => {
    vi.mocked(salons.fetchSalonByCode).mockRejectedValue(new TypeError('Failed to fetch'));
    renderScan();
    expect(await screen.findByRole('heading', { name: 'लाइन नहीं खुल पाई' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('सर्वर से जुड़ नहीं पाए');
    expect(screen.getByRole('button', { name: 'फिर से कोशिश करें' })).toBeInTheDocument();
  });

  it('a message already on screen switches language with the EN button', async () => {
    known();
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(
      new ApiError('This salon is not taking tokens from the app right now.', 403, undefined, 'APP_JOIN_DISABLED'),
    );
    const user = userEvent.setup();
    renderScan(<ScanLanding source="app" />);
    expect(await screen.findByRole('heading', { name: 'अभी टोकन नहीं मिल सकता' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('इस सैलून में अभी ऐप से टोकन बंद है');

    await user.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(screen.getByRole('heading', { name: "Can't get a token right now" })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This salon is not taking tokens from the app right now.');
  });

  it('a server message without a known code stays as the server wrote it', async () => {
    known();
    vi.mocked(tickets.joinSalonQueue).mockRejectedValue(new ApiError('Queue is paused.', 409));
    renderScan();
    expect(await screen.findByRole('alert')).toHaveTextContent('Queue is paused.');
  });
});
