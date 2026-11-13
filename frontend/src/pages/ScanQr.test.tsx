import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import ScanQr from './ScanQr';
import { renderPage } from '../test/utils';
import { resetLangForTests } from '../lib/i18n';

vi.mock('jsqr', () => ({ default: vi.fn(() => null) }));

const stop = vi.fn();
function giveCamera(result: 'ok' | 'denied' | 'none') {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value:
      result === 'none'
        ? undefined
        : {
            getUserMedia: vi.fn(() =>
              result === 'ok'
                ? Promise.resolve({ getTracks: () => [{ stop }] })
                : Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
            ),
          },
  });
}
function giveDetector(values: string[]) {
  let i = 0;
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      detect() {
        const v = values[Math.min(i++, values.length - 1)];
        return Promise.resolve(v ? [{ rawValue: v }] : []);
      }
    },
  );
}

beforeEach(() => {
  localStorage.clear();
  resetLangForTests();
  stop.mockReset();
  // jsdom has no real video: pretend a frame is ready.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
});
afterEach(() => vi.unstubAllGlobals());

const renderScan = () => renderPage(<ScanQr />, { path: '/c/scan', route: '/c/scan' });

describe('in-app QR scan', () => {
  it('opens the salon page (not a token) when a wall QR is seen, and turns the camera off', async () => {
    giveCamera('ok');
    giveDetector(['', 'https://salonqueue.example.in/q/696C52070495']);
    renderScan();
    expect(await screen.findByText('OTHER PAGE', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });

  it('says so when a different QR is scanned, and keeps scanning', async () => {
    giveCamera('ok');
    giveDetector(['upi://pay?pa=shop@bank']);
    renderScan();
    expect(await screen.findByRole('alert')).toHaveTextContent('यह सैलून का QR कोड नहीं है');
  });

  it('explains how to allow the camera when permission is refused, with a retry', async () => {
    giveCamera('denied');
    renderScan();
    expect(await screen.findByRole('alert')).toHaveTextContent('कैमरे की अनुमति नहीं मिली');
    expect(screen.getByRole('button', { name: 'फिर से कोशिश करें' })).toBeInTheDocument();
  });

  it('points to the phone camera app when there is no camera', async () => {
    giveCamera('none');
    renderScan();
    expect(await screen.findByRole('alert')).toHaveTextContent('कैमरा नहीं मिला');
  });
});
