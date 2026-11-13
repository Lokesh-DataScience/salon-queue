// Customer app polish 3a: notification setup in Hindi, and "send a test notification".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotifyMe from './NotifyMe';
import { renderPage } from '../test/utils';
import { ApiError } from '../api/client';
import { resetLangForTests, setLang } from '../lib/i18n';
import * as push from '../lib/push';

vi.mock('../lib/push', () => ({
  fetchPushConfig: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  pushSupport: vi.fn(),
  sendTestPush: vi.fn(),
}));

const TOKEN = 'a'.repeat(40);
const renderNotify = (enabled: boolean) => renderPage(<NotifyMe ticketId="t1" accessToken={TOKEN} enabled={enabled} />);

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  vi.mocked(push.fetchPushConfig).mockReset().mockResolvedValue({ enabled: true, publicKey: 'KEY' });
  vi.mocked(push.pushSupport).mockReset().mockReturnValue('ok');
  vi.mocked(push.sendTestPush).mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('NotifyMe in Hindi', () => {
  it('offers to turn alerts on', async () => {
    renderNotify(false);
    expect(await screen.findByRole('button', { name: 'बारी पास आने पर सूचना दें' })).toBeInTheDocument();
  });

  it('when on, says so and offers a test and a way to turn off', async () => {
    renderNotify(true);
    expect(await screen.findByText('सूचना चालू है')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'टेस्ट सूचना भेजें' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'सूचना बंद करें' })).toBeInTheDocument();
  });

  it('explains how to unblock notifications in Chrome', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    renderNotify(false);
    expect(await screen.findByText(/Site settings → Notifications/)).toBeInTheDocument();
  });
});

describe('Send a test notification', () => {
  it('asks the server to send one, in the page language, and says it was sent', async () => {
    const user = userEvent.setup();
    renderNotify(true);
    await user.click(await screen.findByRole('button', { name: 'टेस्ट सूचना भेजें' }));
    expect(push.sendTestPush).toHaveBeenCalledWith('t1', TOKEN, 'hi');
    expect(await screen.findByText(/टेस्ट भेज दिया/)).toBeInTheDocument();
  });

  it('sends the English test when the page is in English', async () => {
    setLang('en');
    const user = userEvent.setup();
    renderNotify(true);
    await user.click(await screen.findByRole('button', { name: 'Send a test notification' }));
    expect(push.sendTestPush).toHaveBeenCalledWith('t1', TOKEN, 'en');
    expect(await screen.findByText(/Test sent/)).toBeInTheDocument();
  });

  it('tells the customer to turn alerts on again when this phone has no subscription', async () => {
    vi.mocked(push.sendTestPush).mockRejectedValue(new ApiError('x', 409, undefined, 'NO_SUBSCRIPTION'));
    const user = userEvent.setup();
    renderNotify(true);
    await user.click(await screen.findByRole('button', { name: 'टेस्ट सूचना भेजें' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('इस फ़ोन पर सूचना चालू नहीं मिली');
  });

  it('asks to wait when tests are sent too often', async () => {
    vi.mocked(push.sendTestPush).mockRejectedValue(new ApiError('x', 429, undefined, 'TOO_SOON'));
    const user = userEvent.setup();
    renderNotify(true);
    await user.click(await screen.findByRole('button', { name: 'टेस्ट सूचना भेजें' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('थोड़ी देर बाद');
  });
});
