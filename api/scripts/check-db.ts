import mongoose from 'mongoose';
import 'dotenv/config';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

async function main(): Promise<void> {
  console.log('\nChecking MongoDB database connection…\n');

  let url = 'mongodb://127.0.0.1:27017/taskforge';
  if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb')) {
    url = process.env.MONGODB_URI;
  } else if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mongodb')) {
    url = process.env.DATABASE_URL;
  }

  try {
    const conn = await mongoose.connect(url, { serverSelectionTimeoutMS: 5000 });
    console.log(`${GREEN}✓${RESET} Connected to MongoDB database: ${conn.connection.name}`);
    await mongoose.disconnect();
    console.log('\nDatabase connection check completed successfully.\n');
  } catch (error: any) {
    console.error(`${RED}✗${RESET} Could not connect to MongoDB: ${error.message}`);
    process.exit(1);
  }
}

void main();
