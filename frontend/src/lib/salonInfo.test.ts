import { describe, it, expect } from 'vitest';
import { callHref, formatHours, formatRupees, formatTime, mapsHref } from './salonInfo';

describe('formatTime / formatHours', () => {
  it('says the time of day in Hindi', () => {
    expect(formatTime('09:00', 'hi')).toBe('सुबह 9:00');
    expect(formatTime('13:30', 'hi')).toBe('दोपहर 1:30');
    expect(formatTime('17:00', 'hi')).toBe('शाम 5:00');
    expect(formatTime('21:00', 'hi')).toBe('रात 9:00');
    expect(formatTime('00:30', 'hi')).toBe('रात 12:30');
  });

  it('uses AM/PM in English', () => {
    expect(formatTime('09:05', 'en')).toBe('9:05 AM');
    expect(formatTime('12:00', 'en')).toBe('12:00 PM');
    expect(formatTime('21:30', 'en')).toBe('9:30 PM');
  });

  it('shows a range only when both times are readable', () => {
    expect(formatHours('09:00', '21:00', 'hi')).toBe('सुबह 9:00 – रात 9:00');
    expect(formatHours('09:00', null, 'hi')).toBeNull();
    expect(formatHours('25:00', '21:00', 'en')).toBeNull();
  });
});

describe('mapsHref', () => {
  it('prefers the exact location', () => {
    expect(mapsHref({ name: 'Raja', address: 'Main Road', location: { lat: 22.08, lng: 82.15 } })).toBe(
      'https://www.google.com/maps/search/?api=1&query=22.08,82.15',
    );
  });

  it('falls back to the name and address', () => {
    expect(mapsHref({ name: 'Raja Salon', address: 'Main Road, Bilaspur' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Raja%20Salon%2C%20Main%20Road%2C%20Bilaspur',
    );
  });

  it('gives nothing when there is neither', () => {
    expect(mapsHref({ name: 'Raja', address: null, location: null })).toBeNull();
  });
});

describe('callHref', () => {
  it('adds +91 to a plain mobile and keeps a full number', () => {
    expect(callHref('98765 43210')).toBe('tel:+919876543210');
    expect(callHref('+919876543210')).toBe('tel:+919876543210');
  });

  it('refuses junk', () => {
    expect(callHref('call me')).toBeNull();
    expect(callHref(null)).toBeNull();
  });
});

it('formats rupees the Indian way', () => {
  expect(formatRupees(100)).toBe('₹100');
  expect(formatRupees(150000)).toBe('₹1,50,000');
});
