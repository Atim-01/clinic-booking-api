import cors from 'cors';
import { config } from '../config.js';

export const corsMiddleware = cors({
  origin: config.corsOrigin,
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key'],
  exposedHeaders: ['Retry-After'],
  credentials: false,
});
