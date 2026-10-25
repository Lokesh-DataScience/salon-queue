// Usage (from backend/):
//   npm run db:create-salon -- --name "Style Studio" --phone 9876543210 \
//     --address "Main Road, Korba" --lat 22.35 --lng 82.68 --email owner@example.com
// Omit --password and a strong one is generated and printed once.
import { env } from '../src/config/env';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { supabase } from '../src/config/supabase';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    name: { type: 'string' },
    phone: { type: 'string' },
    address: { type: 'string' },
    lat: { type: 'string' },
    lng: { type: 'string' },
    email: { type: 'string' },
    password: { type: 'string' },
    'owner-name': { type: 'string' },
    opening: { type: 'string', default: '09:00' },
    closing: { type: 'string', default: '21:00' },
    avg: { type: 'string', default: '15' },
  },
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm, e.g. 09:00');
const schema = z.object({
  project: z.string().min(10),
  name: z.string().min(2).max(80),
  phone: z.string().regex(/^\+?[0-9]{7,15}$/, 'digits only, 7 to 15'),
  address: z.string().min(5).max(200),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).optional(),
  'owner-name': z.string().min(1).max(80).optional(),
  opening: time,
  closing: time,
  avg: z.coerce.number().int().min(1).max(240),
});

async function main() {
  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    console.error('Invalid arguments:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const p = parsed.data;
    // Refuse to run against the wrong database. The project ref is the first part of the Supabase address.
  const targetRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  if (targetRef !== p.project) {
    console.error(`Refusing to run: this would write to project "${targetRef}", but you asked for "${p.project}".`);
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the right project, then try again.');
    process.exit(1);
  }
  console.log(`Writing to project ${targetRef}...`);
  const password = p.password ?? randomBytes(9).toString('base64url');

  const { data: salon, error } = await supabase
    .from('salons')
    .insert({
      name: p.name,
      phone: p.phone,
      address: p.address,
      latitude: p.lat,
      longitude: p.lng,
      opening_time: p.opening,
      closing_time: p.closing,
      average_service_minutes: p.avg,
    })
    .select('id')
    .single();
  if (error || !salon) {
    console.error('Could not create salon:', error?.code ?? 'unknown');
    process.exit(1);
  }

  const { error: staffError } = await supabase.from('salon_staff').insert({
    salon_id: salon.id,
    name: p['owner-name'] ?? 'Owner',
    email: p.email,
    password_hash: await bcrypt.hash(password, 12),
    role: 'OWNER',
  });
  if (staffError) {
    await supabase.from('salons').delete().eq('id', salon.id); // don't leave a salon nobody can log in to
    console.error('Could not create the owner login:', staffError.code ?? 'unknown', '(email already used?)');
    process.exit(1);
  }

  console.log(`\nSalon created: ${p.name}\n  id:       ${salon.id}\n  login:    ${p.email}`);
  console.log(`  password: ${password}${p.password ? '' : '   <-- shown once, share it securely'}\n`);
}

void main();