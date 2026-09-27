import mongoose from 'mongoose';

const g = globalThis;

/** Thrown when no database is configured and the in-memory fallback is unavailable. */
export class DbNotConfiguredError extends Error {
  constructor() {
    super(
      'MONGODB_URI is not set and the in-memory database fallback is disabled in this environment.'
    );
    this.name = 'DbNotConfiguredError';
    this.isDbConfigError = true;
  }
}

const isServerless = () =>
  Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Returns a connected mongoose connection.
 * Uses MONGODB_URI when set; otherwise (local dev only) spins up an in-memory
 * MongoDB (mongodb-memory-server) so the demo runs with zero env vars.
 * On serverless platforms the fallback is off — set MONGODB_URI instead.
 */
export async function db() {
  if (g.__kereMongoose) return g.__kereMongoose;
  let uri = process.env.MONGODB_URI;
  if (!uri) {
    if (isServerless() && process.env.ALLOW_MEMORY_DB !== '1') {
      throw new DbNotConfiguredError();
    }
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