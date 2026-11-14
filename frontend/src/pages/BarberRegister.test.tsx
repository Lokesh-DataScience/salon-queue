// frontend/src/pages/BarberRegister.test.tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BarberRegister from './BarberRegister';
import { registerSalon } from '../api/barber';
import { reverseGeocode } from '../api/feed';
import { ApiError } from '../api/client';
import { resetLangForTests, setLang } from '../lib/i18n';

vi.mock('../api/barber', () => ({ registerSalon: vi.fn() }));
vi.mock('../api/feed', () => ({ reverseGeocode: vi.fn() }));

const getCurrentPosition = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/barber/register']}>
      <Routes>
        <Route path="/barber/register" element={<BarberRegister />} />
        <Route path="/barber/settings/services" element={<p>SERVICES PAGE</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillDetails({ address = true } = {}) {
  type('Salon name', 'Milan Hair Salon');
  type('Salon mobile number', '98765 43210');
  if (address) type('Salon address', 'Shop 4, Bus Stand Road');
  type('Your name', 'Ramesh');
  type('Password', '123456');
  type('Confirm password', '123456');
}

function locationAllowed() {
  getCurrentPosition.mockImplementation((ok: PositionCallback) =>
    ok({ coords: { latitude: 22.35, longitude: 82.68 } } as GeolocationPosition),
  );
}

function locationDenied() {
  getCurrentPosition.mockImplementation((_ok: PositionCallback, fail: PositionErrorCallback) =>
    fail({ code: 1 } as GeolocationPositionError),
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Register salon' }));
const sent = () => vi.mocked(registerSalon).mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetLangForTests();
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  vi.mocked(reverseGeocode).mockResolvedValue({
    district: 'Korba', state: 'Chhattisgarh', address: 'Main Road, Korba',
  });
  vi.mocked(registerSalon).mockResolvedValue({ staff: {} } as never);
});

describe('BarberRegister — language', () => {
  it('opens in Hindi and switches to English live', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'सैलून रजिस्टर करें' })).toBeInTheDocument();
    expect(screen.getByLabelText('सैलून का मोबाइल नंबर')).toBeInTheDocument();
    act(() => setLang('en'));
    expect(screen.getByRole('heading', { level: 1, name: 'Register your salon' })).toBeInTheDocument();
  });
});

describe('BarberRegister (English)', () => {
  beforeEach(() => setLang('en'));

  it('asks in the agreed order, with no email, latitude or hours', () => {
    renderPage();
    const labels = Array.from(document.querySelectorAll('form label')).map((l) => l.textContent);
    expect(labels).toEqual([
      'Salon name', 'Salon mobile number', 'Salon address', 'District', 'State',
      'Your name', 'Password', 'Confirm password',
    ]);
    // "Fill automatically" sits between the phone and the address.
    const fill = screen.getByRole('button', { name: /fill automatically/i });
    const phone = screen.getByLabelText('Salon mobile number');
    const address = screen.getByLabelText('Salon address');
    expect(phone.compareDocumentPosition(fill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fill.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('blocks a bad form before asking for location', () => {
    renderPage();
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix the items marked in red above.');
    expect(screen.getByText('Enter a valid 10-digit mobile number, e.g. 98765 43210.')).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(registerSalon).not.toHaveBeenCalled();
  });

  it('catches passwords that do not match', () => {
    renderPage();
    fillDetails();
    type('Confirm password', '654321');
    submit();
    expect(screen.getByText('The two passwords do not match.')).toBeInTheDocument();
    expect(registerSalon).not.toHaveBeenCalled();
  });

  it('"Fill automatically" fills address, district and state', async () => {
    locationAllowed();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /fill automatically/i }));
    expect(await screen.findByText('Location found')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Salon address')).toHaveValue('Main Road, Korba'));
    expect(screen.getByLabelText('District')).toHaveValue('Korba');
    expect(screen.getByLabelText('State')).toHaveValue('Chhattisgarh');
  });

  it('registers with the location from "Fill automatically" and opens Services', async () => {
    locationAllowed();
    renderPage();
    fillDetails({ address: false });
    fireEvent.click(screen.getByRole('button', { name: /fill automatically/i }));
    await waitFor(() => expect(screen.getByLabelText('Salon address')).toHaveValue('Main Road, Korba'));

    submit();
    expect(await screen.findByText('SERVICES PAGE')).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1); // not asked again on Register
    expect(sent()).toEqual({
      salonName: 'Milan Hair Salon',
      phone: '98765 43210',
      address: 'Main Road, Korba',
      latitude: 22.35,
      longitude: 82.68,
      district: 'Korba',
      state: 'Chhattisgarh',
      ownerName: 'Ramesh',
      password: '123456',
      openingTime: '09:00',
      closingTime: '21:00',
      averageServiceMinutes: 15,
    });
  });

  it('asks for location on Register when the button was skipped, keeping the typed address', async () => {
    locationAllowed();
    renderPage();
    fillDetails();
    submit();
    expect(await screen.findByText('SERVICES PAGE')).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(sent()).toMatchObject({
      address: 'Shop 4, Bus Stand Road',
      latitude: 22.35,
      longitude: 82.68,
      district: 'Korba',
      state: 'Chhattisgarh',
    });
  });

  it('still registers, without a location, when permission is denied', async () => {
    locationDenied();
    renderPage();
    fillDetails();
    submit();
    expect(await screen.findByText('SERVICES PAGE')).toBeInTheDocument();
    expect(sent()).not.toHaveProperty('latitude');
    expect(sent()).not.toHaveProperty('longitude');
    expect(reverseGeocode).not.toHaveBeenCalled();
  });

  it('does not ask again on Register after "Fill automatically" was denied', async () => {
    locationDenied();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /fill automatically/i }));
    expect(await screen.findByText(/type the address yourself/)).toBeInTheDocument();
    fillDetails();
    submit();
    expect(await screen.findByText('SERVICES PAGE')).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(sent()).not.toHaveProperty('latitude');
  });

  it('says when the number is already registered', async () => {
    locationDenied();
    vi.mocked(registerSalon).mockRejectedValue(new ApiError('already registered', 409));
    renderPage();
    fillDetails();
    submit();
    expect(await screen.findByText('This number is already registered. Sign in instead.')).toBeInTheDocument();
  });

  it('says so when the server cannot be reached', async () => {
    locationDenied();
    vi.mocked(registerSalon).mockRejectedValue(new TypeError('fetch failed'));
    renderPage();
    fillDetails();
    submit();
    expect(await screen.findByText(/could not reach the server/)).toBeInTheDocument();
  });

  it('shows and hides both passwords', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
  });
});