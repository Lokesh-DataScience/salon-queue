// frontend/src/lib/features.ts
// Customer-side discovery (salon list, salon details, manual join) is switched off: customers arrive by scanning
// the salon's QR code. The pages and routes still exist; set VITE_CUSTOMER_DISCOVERY=true at build time to bring them back.
export const CUSTOMER_DISCOVERY = import.meta.env.VITE_CUSTOMER_DISCOVERY === 'true';
