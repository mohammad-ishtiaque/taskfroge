import 'dotenv/config';
import mongoose from 'mongoose';

function getTestMongoUri(): string {
  if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb')) {
    return process.env.MONGODB_URI.replace(/\/[^/?]+(\?|$)/, '/taskforge_test$1');
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mongodb')) {
    return process.env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/taskforge_test$1');
  }
  return 'mongodb://127.0.0.1:27017/taskforge_test';
}

async function main(): Promise<void> {
  const mongoUri = getTestMongoUri();
  console.log(`Connecting to test database: ${mongoUri}`);

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB test database.');
  await mongoose.disconnect();

  console.log('\nReady. Tests will use MongoDB taskforge_test.\n');
}

void main().catch((error: unknown) => {
  console.error('\nCould not set up the test database:', error);
  process.exit(1);
});
