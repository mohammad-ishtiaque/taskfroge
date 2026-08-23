import mongoose, { ClientSession } from 'mongoose';
import { env, isProduction } from '../config/env';
import { logger } from './logger';

/* ==========================================================================
   Mongoose Connection Management
   --------------------------------------------------------------------------
   Handles connection lifecycle, auto-reconnection, readiness probes,
   and multi-document transactions.
   ========================================================================== */

function getMongoUri(): string {
  if (env.MONGODB_URI && env.MONGODB_URI.startsWith('mongodb')) return env.MONGODB_URI;
  if (env.DATABASE_URL && env.DATABASE_URL.startsWith('mongodb')) return env.DATABASE_URL;
  return 'mongodb://127.0.0.1:27017/taskforge';
}

const mongoUri = getMongoUri();

// Mongoose global configuration
mongoose.set('strictQuery', true);

let isConnected = false;

export async function connectDatabase(): Promise<typeof mongoose> {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: !isProduction,
    });

    isConnected = true;
    logger.info('Connected to MongoDB via Mongoose');
    return conn;
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to MongoDB');
    throw error;
  }
}

mongoose.connection.on('connected', () => {
  isConnected = true;
  logger.info('Mongoose connection established');
});

mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'Mongoose connection error');
});

mongoose.connection.on('disconnected', () => {
  isConnected = false;
  logger.warn('Mongoose connection disconnected');
});

export async function pingDatabase(): Promise<boolean> {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDatabase();
    }
    const adminDb = mongoose.connection.db?.admin();
    if (!adminDb) return false;
    const res = await adminDb.ping();
    return res.ok === 1;
  } catch (error) {
    logger.error({ err: error }, 'Database ping failed');
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Disconnected from MongoDB');
  }
}

/**
 * Execute operations inside a MongoDB transaction session.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>
): Promise<T> {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
  }
  const session = await mongoose.startSession();
  try {
    let result: T = undefined as unknown as T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export { mongoose };
