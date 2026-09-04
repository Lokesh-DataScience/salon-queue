// backend/supabase/seed.ts
import bcrypt from 'bcrypt';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const demoSalons = [
  {
    name: 'Style Studio',
    description: 'Modern cuts and classic shaves in the heart of the city.',
    phone: '+91-9000000001',
    address: '12 MG Road, Bhopal',
    latitude: 23.2599,
    longitude: 77.4126,
    opening_time: '09:00',
    closing_time: '20:00',
    average_service_minutes: 20,
  },
  {
    name: 'The Barber Co.',
    description: 'Traditional barbershop, walk-ins welcome.',
    phone: '+91-9000000002',
    address: '45 Arera Colony, Bhopal',
    latitude: 23.2156,
    longitude: 77.4342,
    opening_time: '10:00',
    closing_time: '21:00',
    average_service_minutes: 15,
  },
  {
    name: 'Glow & Go Salon',
    description: 'Unisex salon specializing in fast, friendly service.',
    phone: '+91-9000000003',
    address: '78 New Market, Bhopal',
    latitude: 23.2325,
    longitude: 77.4029,
    opening_time: '09:30',
    closing_time: '19:30',
    average_service_minutes: 25,
  },
  {
    name: 'Urban Trim',
    description: 'Quick, no-frills haircuts for busy schedules.',
    phone: '+91-9000000004',
    address: '3 Kolar Road, Bhopal',
    latitude: 23.1996,
    longitude: 77.4386,
    opening_time: '08:00',
    closing_time: '18:00',
    average_service_minutes: 12,
  },
  {
    name: 'Classic Cuts',
    description: 'Old-school barbering with a modern queue system.',
    phone: '+91-9000000005',
    address: '90 Habibganj, Bhopal',
    latitude: 23.2276,
    longitude: 77.4353,
    opening_time: '09:00',
    closing_time: '20:30',
    average_service_minutes: 18,
  },
];

const DEV_PASSWORD = 'testpass123';

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function seedSalons() {
  console.log('Seeding demo salons...');
  const salonIdsByName = new Map<string, string>();

  for (const salon of demoSalons) {
    const { data: existing, error: findError } = await supabase
      .from('salons')
      .select('id')
      .eq('name', salon.name)
      .maybeSingle();

    if (findError) {
      throw new Error(`Failed checking for existing salon "${salon.name}": ${findError.message}`);
    }

    if (existing) {
      console.log(`  - "${salon.name}" already exists, skipping.`);
      salonIdsByName.set(salon.name, existing.id);
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('salons')
      .insert(salon)
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Failed inserting salon "${salon.name}": ${insertError.message}`);
    }

    console.log(`  + inserted "${salon.name}"`);
    salonIdsByName.set(salon.name, inserted.id);
  }

  console.log(`Done. ${demoSalons.length} demo salons ensured.`);
  return salonIdsByName;
}

async function seedBarbers(salonIdsByName: Map<string, string>) {
  console.log('Seeding demo barber accounts...');
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  const credentials: { email: string; salon: string }[] = [];

  for (const salon of demoSalons) {
    const salonId = salonIdsByName.get(salon.name);
    if (!salonId) continue; // shouldn't happen, but keeps this defensive

    const email = `owner@${slugify(salon.name)}.test`;

    const { data: existing, error: findError } = await supabase
      .from('salon_staff')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (findError) {
      throw new Error(`Failed checking for existing staff "${email}": ${findError.message}`);
    }

    if (existing) {
      console.log(`  - "${email}" already exists, skipping.`);
      credentials.push({ email, salon: salon.name });
      continue;
    }

    const { error: insertError } = await supabase.from('salon_staff').insert({
      salon_id: salonId,
      name: `${salon.name} Owner`,
      email,
      password_hash: passwordHash,
      role: 'OWNER',
    });

    if (insertError) {
      throw new Error(`Failed inserting staff "${email}": ${insertError.message}`);
    }

    console.log(`  + inserted "${email}"`);
    credentials.push({ email, salon: salon.name });
  }

  console.log(`Done. ${credentials.length} demo barber accounts ensured.`);
  console.log(`\nDev login credentials (password for all: "${DEV_PASSWORD}"):`);
  credentials.forEach((c) => console.log(`  ${c.email}  →  ${c.salon}`));
}

async function main() {
  const salonIdsByName = await seedSalons();
  await seedBarbers(salonIdsByName);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});