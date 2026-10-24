import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPushConfig, enablePush, disablePush, pushSupport } from '../lib/push';

type Props = { ticketId: string; accessToken: string; enabled: boolean };

export default function NotifyMe({ ticketId, accessToken, enabled }: Props) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data: config } = useQuery({
    queryKey: ['pushConfig'],
    queryFn: fetchPushConfig,
    staleTime: Infinity,
    retry: false,
  });

  // Server has push switched off (or unreachable): say nothing, the page's "keep this page open" line stays.
  if (!config?.enabled || !config.publicKey) return null;
  const publicKey = config.publicKey;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await enablePush(ticketId, accessToken, publicKey);
      if (result === 'denied') {
        setMessage('Notifications are blocked for this site. Allow them in your browser settings, or keep this page open.');
      } else {
        await refresh();
      }
    } catch (err) {
      // Shown in the browser console so a failure can be diagnosed.
      console.error(
        '[push] could not enable notifications:',
        err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error',
      );
      setMessage("We couldn't turn on notifications. Please try again, or keep this page open.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      await disablePush(ticketId, accessToken);
      await refresh();
    } catch {
      setMessage("We couldn't turn off notifications. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (enabled) {
    return (
      <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-4 text-green-900" role="status">
        <p className="font-semibold">Notifications are on</p>
        <p className="text-sm">
          Keep your internet on and you can close this page. We'll alert you when your turn is close.
        </p>
        <button type="button" onClick={turnOff} disabled={busy} className="btn-secondary mt-3">
          {busy ? 'Turning off...' : 'Turn off notifications'}
        </button>
        {message && <p className="mt-2 text-sm text-red-800" role="alert">{message}</p>}
      </div>
    );
  }

  const support = pushSupport();
  if (support === 'ios-install') {
    return (
      <p className="mt-4 rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
        On iPhone, add this site to your Home Screen (Share, then Add to Home Screen) to get notifications.
        Otherwise, keep this page open.
      </p>
    );
  }
  if (support === 'unsupported') {
    return (
      <p className="mt-4 text-sm text-gray-600">
        This browser can't send notifications, so please keep this page open.
      </p>
    );
  }

  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  if (blocked) {
    return (
      <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        Notifications are blocked for this site. Allow them in your browser settings to get an alert, or keep this
        page open.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={turnOn} disabled={busy} className="btn-primary">
        {busy ? 'Turning on...' : "Notify me when it's almost my turn"}
      </button>
      {message && <p className="mt-2 text-sm text-red-800" role="alert">{message}</p>}
    </div>
  );
}