import dotenv from 'dotenv';

// Load appropriate env file
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test' });
} else {
  dotenv.config();
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.NODE_ENV === 'test' 
    ? process.env.TEST_DATABASE_URL 
    : process.env.DATABASE_URL,
  apiKey: process.env.API_KEY,
  corsOrigin: process.env.CORS_ORIGIN || '*',
};

// Validate critical config
if (process.env.NODE_ENV === 'test') {
  if (!config.databaseUrl) {
    console.error('TEST_DATABASE_URL is required for tests');
    process.exit(1);
  }
  if (config.databaseUrl === process.env.DATABASE_URL) {
    console.error('TEST_DATABASE_URL must not equal DATABASE_URL');
    process.exit(1);
  }
}
