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

export async function withTransaction<T>(
  fn: (session?: ClientSession) => Promise<T>
): Promise<T> {
  if (mongoose.connection.readyState !== 1) {
    await connectDatabase();
  }

  let session: ClientSession | null = null;
  try {
    session = await mongoose.startSession();
  } catch {
    // MongoDB standalone instance does not support sessions/transactions
    return fn(undefined);
  }

  try {
    let result: T = undefined as unknown as T;
    try {
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result;
    } catch (err: any) {
      // If transactions are not supported (e.g. standalone MongoDB instance without replica set)
      const msg = err?.message || '';
      if (
        msg.includes('Transaction numbers are only allowed on a replica set') ||
        msg.includes('Transactions are not supported') ||
        msg.includes('This MongoDB deployment does not support transactions')
      ) {
        logger.warn('Transactions not supported on standalone MongoDB; executing directly');
        return await fn(undefined);
      }
      throw err;
    }
  } finally {
    await session.endSession().catch(() => {});
  }
}

export { mongoose };
