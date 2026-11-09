// frontend/src/lib/multiBarber.ts
// Hidden, not deleted: the Team section stays out of Settings until VITE_MULTI_BARBER=true.
// Turn it on only once the customer side and the barber dashboard understand lanes.
export const MULTI_BARBER = import.meta.env.VITE_MULTI_BARBER === 'true';