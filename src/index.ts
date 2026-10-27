import { app } from './app.js';
import { config } from './config.js';

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
