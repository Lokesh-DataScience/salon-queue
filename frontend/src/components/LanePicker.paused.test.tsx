// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LanePicker from './LanePicker';
import { setLang } from '../lib/i18n';

// These tests check the English wording; the Hindi default has its own tests.
beforeEach(() => setLang('en'));

afterEach(cleanup);

describe('LanePicker with a barber on a break', () => {
  it('shows the barber as on a break, cannot be chosen, and "Any barber" ignores them', () => {
    render(
      <LanePicker
        value={null}
        onChange={() => {}}
        lanes={[
          { id: 'a', name: 'Owner', waitingCount: 2, estimatedWaitMinutes: 25 },
          { id: 'b', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 0, isPaused: true },
        ]}
      />,
    );
    expect(screen.getByText('On a break')).toBeTruthy();
    expect((screen.getByLabelText(/Rahul/) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Owner/) as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('Shortest wait · ~25 min')).toBeTruthy(); // not the 0 of the barber on a break
  });

  it('says so when every barber is on a break', () => {
    render(
      <LanePicker
        value={null}
        onChange={() => {}}
        lanes={[
          { id: 'a', name: 'Owner', waitingCount: 0, estimatedWaitMinutes: 0, isPaused: true },
          { id: 'b', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 0, isPaused: true },
        ]}
      />,
    );
    expect(screen.getByText('Everyone is on a break')).toBeTruthy();
    expect((screen.getByLabelText(/Any barber/) as HTMLInputElement).disabled).toBe(true);
  });
});
