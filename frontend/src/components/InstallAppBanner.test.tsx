// frontend/src/components/InstallAppBanner.test.tsx
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallAppBanner from './InstallAppBanner';
import { resetInstallStateForTests, startInstallCapture } from '../lib/installPrompt';

const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

function asBrowser(ua: string, standalone = false) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  window.matchMedia = vi.fn().mockReturnValue({ matches: standalone }) as unknown as typeof window.matchMedia;
}

// What Chrome fires when the page can be installed.
function offerInstall(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

beforeAll(() => startInstallCapture());
beforeEach(() => {
  resetInstallStateForTests();
  window.history.replaceState(null, '', '/tickets/t1');
});
afterEach(() => vi.restoreAllMocks());

describe('InstallAppBanner', () => {
  it('Android with Chrome install ready: one tap opens Chrome\'s install dialog, then the banner goes', async () => {
    asBrowser(ANDROID);
    render(<InstallAppBanner />);
    const e = offerInstall('accepted');
    expect(e.defaultPrevented).toBe(true); // our banner replaces Chrome's mini bar

    expect(screen.getByText('अगली बार घर बैठे टोकन लें')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ऐप डाउनलोड करें' }));
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('अगली बार घर बैठे टोकन लें')).not.toBeInTheDocument();
  });

  it('Android without the install prompt: shows Chrome menu steps', async () => {
    asBrowser(ANDROID);
    render(<InstallAppBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'ऐप डाउनलोड करें' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Chrome का मेनू');
    await userEvent.click(screen.getByRole('button', { name: 'ठीक है' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('iPhone: shows Share → Add to Home Screen steps', async () => {
    asBrowser(IPHONE);
    render(<InstallAppBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'ऐप डाउनलोड करें' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Add to Home Screen');
  });

  it('hidden inside the installed app', () => {
    asBrowser(ANDROID, true);
    render(<InstallAppBanner />);
    expect(screen.queryByText('अगली बार घर बैठे टोकन लें')).not.toBeInTheDocument();
  });

  it('hidden on a desktop browser that cannot install', () => {
    asBrowser(DESKTOP);
    render(<InstallAppBanner />);
    expect(screen.queryByText('अगली बार घर बैठे टोकन लें')).not.toBeInTheDocument();
  });

  it('"later" hides it for 7 days, then it comes back', async () => {
    asBrowser(ANDROID);
    const { unmount } = render(<InstallAppBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'बाद में' }));
    expect(screen.queryByText('अगली बार घर बैठे टोकन लें')).not.toBeInTheDocument();
    unmount();

    render(<InstallAppBanner />);
    expect(screen.queryByText('अगली बार घर बैठे टोकन लें')).not.toBeInTheDocument(); // still dismissed

    localStorage.setItem('svq.installBanner.dismissedAt', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
    render(<InstallAppBanner />);
    expect(screen.getByText('अगली बार घर बैठे टोकन लें')).toBeInTheDocument();
  });

  it('goes away when the app gets installed from Chrome\'s own menu', () => {
    asBrowser(ANDROID);
    render(<InstallAppBanner />);
    expect(screen.getByText('अगली बार घर बैठे टोकन लें')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByText('अगली बार घर बैठे टोकन लें')).not.toBeInTheDocument();
  });

  it('never takes over the install prompt on barber pages', () => {
    asBrowser(ANDROID);
    window.history.replaceState(null, '', '/barber/dashboard');
    const e = offerInstall();
    expect(e.defaultPrevented).toBe(false);
  });
});
