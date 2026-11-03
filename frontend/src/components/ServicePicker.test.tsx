// frontend/src/components/ServicePicker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServicePicker from './ServicePicker';

const services = [
  { id: 's1', name: 'hair cutting' },
  { id: 's2', name: 'beard trimming' },
];

function setup(over: Partial<React.ComponentProps<typeof ServicePicker>> = {}) {
  const onSubmit = vi.fn();
  render(
    <ServicePicker salonName="Style Studio" services={services} submitting={false} onSubmit={onSubmit} {...over} />,
  );
  return onSubmit;
}

describe('ServicePicker', () => {
  it('lists every service, none ticked', () => {
    setup();
    expect(screen.getByLabelText('hair cutting')).not.toBeChecked();
    expect(screen.getByLabelText('beard trimming')).not.toBeChecked();
  });

  it('submits the chosen ids in list order', async () => {
    const onSubmit = setup();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('beard trimming'));
    await user.click(screen.getByLabelText('hair cutting'));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith(['s1', 's2']);
  });

  it('asks before submitting with nothing chosen', async () => {
    const onSubmit = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('You can choose any service if you want.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Back closes the pop-up without submitting', async () => {
    const onSubmit = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Escape closes the pop-up', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Continue submits with no services', async () => {
    const onSubmit = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(onSubmit).toHaveBeenCalledWith([]);
  });

  it('disables Submit while submitting and shows a server message', () => {
    setup({ submitting: true, message: 'Salon is currently closed.' });
    expect(screen.getByRole('button', { name: /getting your token/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Salon is currently closed.');
  });
});