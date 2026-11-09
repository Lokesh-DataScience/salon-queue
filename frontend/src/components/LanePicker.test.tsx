// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import LanePicker from './LanePicker';

afterEach(cleanup);

const lanes = [
  { id: 'a', name: 'Owner', waitingCount: 3, estimatedWaitMinutes: 40 },
  { id: 'b', name: 'Rahul', waitingCount: 0, estimatedWaitMinutes: 0 },
  { id: 'c', name: 'Imran', waitingCount: 0, estimatedWaitMinutes: 12 },
];

describe('LanePicker', () => {
  it('lists "Any barber" first, then every barber, with their wait in words', () => {
    render(<LanePicker lanes={lanes} value={null} onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByLabelText(/Any barber/)).toBeTruthy();
    expect(screen.getByText('3 waiting · ~40 min')).toBeTruthy();
    expect(screen.getByText('No wait')).toBeTruthy();
    expect(screen.getByText('Next in line · ~12 min')).toBeTruthy();
    expect(screen.getByText('No wait right now')).toBeTruthy(); // "Any barber" reflects the shortest line
  });

  it('marks the current choice and reports a change (null means Any barber)', () => {
    const onChange = vi.fn();
    render(<LanePicker lanes={lanes} value="b" onChange={onChange} />);
    expect((screen.getByLabelText(/Rahul/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Any barber/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(/Any barber/));
    expect(onChange).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByLabelText(/Imran/));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('is a labelled group and can be switched off while joining', () => {
    render(<LanePicker lanes={lanes} value={null} onChange={() => {}} disabled />);
    expect(screen.getByRole('group', { name: 'Choose your barber' })).toBeTruthy();
    for (const r of screen.getAllByRole('radio')) expect(r.matches(':disabled')).toBe(true); // inherited from the fieldset
  });
});