import { app } from './app.js';
import { config } from './config.js';
import { initSchema } from './db.js';

async function start() {
  try {
    // Initialize database schema
    await initSchema();
    console.log('Database schema initialized');

    const server = app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, closing server...');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
