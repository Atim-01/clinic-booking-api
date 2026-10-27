import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { send401 } from './errors.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Skip auth for GET /health
  if (req.method === 'GET' && req.path === '/health') {
    return next();
  }

  // Check API key
  const apiKey = req.get('X-API-Key');
  if (!apiKey || apiKey !== config.apiKey) {
    return send401(res);
  }

  next();
}
