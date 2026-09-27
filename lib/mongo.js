import mongoose from 'mongoose';

const g = globalThis;

/**
 * Returns a connected mongoose connection.
 * Uses MONGODB_URI when set; otherwise spins up an in-memory MongoDB
 * (mongodb-memory-server) so the demo runs with zero env vars.
 */
export async function db() {
  if (g.__kereMongoose) return g.__kereMongoose;
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    if (!g.__kereMemoryServer) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      g.__kereMemoryServer = await MongoMemoryServer.create();
    }
    uri = g.__kereMemoryServer.getUri('kereshop');
  }
  g.__kereMongoose = await mongoose.connect(uri);
  return g.__kereMongoose;
}

export const isMemoryDb = () => !process.env.MONGODB_URI;