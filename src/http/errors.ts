import { Response } from 'express';

export function sendError(res: Response, statusCode: number, message: string): void {
  res.status(statusCode).json({ error: message });
}

export function send401(res: Response): void {
  sendError(res, 401, 'unauthorized');
}

export function send400(res: Response, message: string = 'invalid booking'): void {
  sendError(res, 400, message);
}

export function send404(res: Response, message: string = 'not found'): void {
  sendError(res, 404, message);
}

export function send409(res: Response, message: string): void {
  sendError(res, 409, message);
}

export function send422(res: Response, message: string): void {
  sendError(res, 422, message);
}

export function send429(res: Response, retryAfter: number): void {
  res.set('Retry-After', String(retryAfter));
  sendError(res, 429, 'too many attempts');
}

export function send500(res: Response): void {
  sendError(res, 500, 'internal error');
}
