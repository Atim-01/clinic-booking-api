import { randomUUID } from 'crypto';

export function generateBookingId(): string {
  return randomUUID();
}
