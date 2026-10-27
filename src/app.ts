import express, { Request, Response, NextFunction } from 'express';
import { corsMiddleware } from './http/cors.js';
import { send404, send400, send500 } from './http/errors.js';

export const app = express();

// Middleware order: CORS first, then auth (later), then JSON parser
app.use(corsMiddleware);

// Health endpoint (no auth required)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// JSON parser with error handling
app.use(express.json());

// Catch JSON parse errors
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return send400(res, 'invalid json');
  }
  next(err);
});

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  send404(res, 'not found');
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  send500(res);
});
