// backend/src/utils/suspension.ts
// Wording for a salon the founder has suspended. Customers and staff see different messages.
export const SALON_SUSPENDED_PUBLIC = 'This salon is not taking bookings right now.';
export const SALON_SUSPENDED_STAFF = "This salon's account is paused. Please contact Salon Queue support.";

// The queue_entries trigger raises SALON_SUSPENDED when a ticket is created for a suspended salon.
export function isSalonSuspendedError(err: unknown): boolean {
  return String((err as { message?: unknown } | null)?.message ?? '').includes('SALON_SUSPENDED');
}
