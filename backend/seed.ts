import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const demoSalons = [
  {
    name: 'Style Studio',
    description: 'Modern cuts and classic shaves in the heart of the city.',
    phone: '+91-9000000001',
    address: '12 MG Road, Bhopal',
    latitude: 23.2599,
    longitude: 77.4126,
    openingTime: '09:00',
    closingTime: '20:00',
    averageServiceMinutes: 20,
  },
  {
    name: 'The Barber Co.',
    description: 'Traditional barbershop, walk-ins welcome.',
    phone: '+91-9000000002',
    address: '45 Arera Colony, Bhopal',
    latitude: 23.2156,
    longitude: 77.4342,
    openingTime: '10:00',
    closingTime: '21:00',
    averageServiceMinutes: 15,
  },
  {
    name: 'Glow & Go Salon',
    description: 'Unisex salon specializing in fast, friendly service.',
    phone: '+91-9000000003',
    address: '78 New Market, Bhopal',
    latitude: 23.2325,
    longitude: 77.4029,
    openingTime: '09:30',
    closingTime: '19:30',
    averageServiceMinutes: 25,
  },
  {
    name: 'Urban Trim',
    description: 'Quick, no-frills haircuts for busy schedules.',
    phone: '+91-9000000004',
    address: '3 Kolar Road, Bhopal',
    latitude: 23.1996,
    longitude: 77.4386,
    openingTime: '08:00',
    closingTime: '18:00',
    averageServiceMinutes: 12,
  },
  {
    name: 'Classic Cuts',
    description: 'Old-school barbering with a modern queue system.',
    phone: '+91-9000000005',
    address: '90 Habibganj, Bhopal',
    latitude: 23.2276,
    longitude: 77.4353,
    openingTime: '09:00',
    closingTime: '20:30',
    averageServiceMinutes: 18,
  },
];

async function main() {
  console.log('Seeding demo salons...');

  for (const salon of demoSalons) {
    await prisma.salon.upsert({
      where: { id: salon.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
      update: {},
      create: {
        id: salon.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        ...salon,
      },
    });
  }

  console.log(`Seeded ${demoSalons.length} demo salons.`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });