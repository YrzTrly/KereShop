import mongoose from 'mongoose';
import { isMemoryDb } from '../lib/mongo.js';
import { seedDemoData } from '../lib/seed.js';

const result = await seedDemoData();

if (result.created) {
  console.log('Seeded Kere Fashion:');
  console.log(`  products:   ${result.products}`);
  console.log(`  customers:  ${result.customers}`);
  console.log(`  orders:     ${result.orders}`);
} else {
  console.log('Demo shop "Kere Fashion" already exists — nothing to do.');
}
if (isMemoryDb()) {
  console.log('\nNo MONGODB_URI set — data was written to an ephemeral in-memory MongoDB.');
  console.log('Set MONGODB_URI and run again to persist the seed.');
}

await mongoose.disconnect();
process.exit(0);