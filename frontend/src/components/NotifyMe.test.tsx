import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotifyMe from './NotifyMe';
import { renderPage } from '../test/utils';
import * as push from '../lib/push';

vi.mock('../lib/push', () => ({
  fetchPushConfig: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  pushSupport: vi.fn(),
}));

const TOKEN = 'a'.repeat(40);
const renderNotify = (enabled = false) =>
  renderPage(<NotifyMe ticketId="t1" accessToken={TOKEN} enabled={enabled} />);

beforeEach(() => {
  vi.mocked(push.fetchPushConfig).mockReset().mockResolvedValue({ enabled: true, publicKey: 'KEY' });
  vi.mocked(push.enablePush).mockReset();
  vi.mocked(push.disablePush).mockReset();
  vi.mocked(push.pushSupport).mockReset().mockReturnValue('ok');
});
afterEach(() => vi.unstubAllGlobals());

describe('NotifyMe', () => {
  it('renders nothing when the server has push switched off', async () => {
    vi.mocked(push.fetchPushConfig).mockResolvedValue({ enabled: false, publicKey: null });
    const { container } = renderNotify();
    await vi.waitFor(() => expect(push.fetchPushConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('turns notifications on from the button', async () => {
    vi.mocked(push.enablePush).mockResolvedValue('enabled');
    const user = userEvent.setup();
    renderNotify();

    await user.click(await screen.findByRole('button', { name: /notify me/i }));
    expect(push.enablePush).toHaveBeenCalledWith('t1', TOKEN, 'KEY');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains what to do when the customer refuses permission', async () => {
    vi.mocked(push.enablePush).mockResolvedValue('denied');
    const user = userEvent.setup();
    renderNotify();

    await user.click(await screen.findByRole('button', { name: /notify me/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked for this site/i);
  });

  it('shows a friendly error when subscribing fails', async () => {
    vi.mocked(push.enablePush).mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderNotify();

    await user.click(await screen.findByRole('button', { name: /notify me/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't turn on notifications/i);
  });

  it('when on: promises the page can be closed, and can be turned off', async () => {
    vi.mocked(push.disablePush).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderNotify(true);

    expect(await screen.findByText('Notifications are on')).toBeInTheDocument();
    expect(screen.getByText(/you can close this page/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn off notifications' }));
    expect(push.disablePush).toHaveBeenCalledWith('t1', TOKEN);
  });

  it('tells iPhone visitors to add the site to the Home Screen', async () => {
    vi.mocked(push.pushSupport).mockReturnValue('ios-install');
    renderNotify();
    expect(await screen.findByText(/add this site to your home screen/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /notify me/i })).not.toBeInTheDocument();
  });

  it('is honest on browsers that cannot send notifications', async () => {
    vi.mocked(push.pushSupport).mockReturnValue('unsupported');
    renderNotify();
    expect(await screen.findByText(/please keep this page open/i)).toBeInTheDocument();
  });

  it('shows the blocked message, with no button, when permission was already denied', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' });
    renderNotify();
    expect(await screen.findByText(/blocked for this site/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /notify me/i })).not.toBeInTheDocument();
  });
});