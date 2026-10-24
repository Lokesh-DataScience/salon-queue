// backend/tests/setup.ts
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { setIO } from '../src/sockets/io';

const testEnvPath = path.resolve(process.cwd(), '.env.test');
if (!fs.existsSync(testEnvPath)) {
  throw new Error('Missing backend/.env.test. Create it from the test Supabase project.');
}
const testEnv = dotenv.parse(fs.readFileSync(testEnvPath));

// SAFETY: tests create and delete rows. Never let them touch production.
const prod = testEnv.PRODUCTION_SUPABASE_URL;
if (!prod) {
  throw new Error('Set PRODUCTION_SUPABASE_URL in .env.test so the safety check can protect production.');
}
if (testEnv.SUPABASE_URL === prod) {
  throw new Error('SAFETY STOP: .env.test points at the production Supabase project.');
}

Object.assign(process.env, testEnv); // env.ts's dotenv/config won't override these

// broadcastQueueUpdate calls getIO(); give it a no-op server.
setIO({ to: () => ({ emit: () => undefined }) } as never);