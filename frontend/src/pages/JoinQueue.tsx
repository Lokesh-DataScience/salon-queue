import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { joinSalonQueue } from '../api/tickets';

export default function JoinQueue() {
  const { salonId } = useParams<{ salonId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await joinSalonQueue(salonId!, name, phone);
      navigate(`/tickets/${ticket.ticketId}?accessToken=${ticket.accessToken}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-xl font-semibold mb-1">Join Queue</h1>
      <p className="text-sm text-gray-500 mb-4">
        No account required. Your details are only used for this queue and notifications.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Your name</label>
          <input
            className="w-full rounded-lg border border-gray-300 p-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Your mobile number</label>
          <input
            className="w-full rounded-lg border border-gray-300 p-3"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-black text-white py-3 font-medium disabled:opacity-50"
        >
          {submitting ? 'Joining queue...' : 'Get My Token'}
        </button>
      </form>
    </div>
  );
}