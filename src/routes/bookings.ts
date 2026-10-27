import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { generateBookingId } from '../ids.js';
import { formatISO } from '../time.js';
import { send404, send400, send409, send422 } from '../http/errors.js';
import { isValidEmail, normalizeEmail } from '../lib/email.js';
import {
  claimIdempotencyKey,
  pollIdempotencyKey,
  storeIdempotencyResponse,
  generateFingerprint,
} from '../lib/idempotency.js';

export const bookingsRouter = Router();

interface Booking {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}

// POST /bookings - Create a booking
bookingsRouter.post('/bookings', async (req: Request, res: Response) => {
  const idempotencyKey = req.get('Idempotency-Key');
  let claimed = false;

  try {
    // Handle idempotency
    if (idempotencyKey) {
      const fingerprint = generateFingerprint(req.body);
      const claimResult = await claimIdempotencyKey(pool, idempotencyKey, fingerprint);

      if (!claimResult.claimed) {
        // Either replaying or need to poll
        if (claimResult.statusCode !== undefined) {
          // Replay stored response
          return res.status(claimResult.statusCode).json(claimResult.body);
        }

        // Need to poll (winner still processing)
        const pollResult = await pollIdempotencyKey(pool, idempotencyKey);
        return res.status(pollResult.statusCode!).json(pollResult.body);
      }

      // We claimed the key
      claimed = true;
    }

    const { slot_id, name, email } = req.body;

    // Validate required fields
    if (!slot_id || typeof slot_id !== 'string' || !slot_id.trim()) {
      const statusCode = 400;
      const body = { error: 'invalid booking' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      const statusCode = 400;
      const body = { error: 'invalid booking' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      const statusCode = 400;
      const body = { error: 'invalid booking' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }

    // Validate email format
    if (!isValidEmail(email)) {
      const statusCode = 400;
      const body = { error: 'invalid booking' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }

    const trimmedName = name.trim();
    const normalizedEmail = normalizeEmail(email);

    // Check if slot exists
    const slotResult = await pool.query(
      'SELECT id, start_ts FROM slots WHERE id = $1',
      [slot_id.trim()]
    );

    if (slotResult.rows.length === 0) {
      const statusCode = 404;
      const body = { error: 'slot not found' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }

    const slot = slotResult.rows[0];
    const slotStart = new Date(slot.start_ts);
    const now = new Date();

    // Check if slot has already started
    if (now >= slotStart) {
      const statusCode = 400;
      const body = { error: 'slot already started' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }

    const bookingId = generateBookingId();

    const result = await pool.query(
      `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', now())
       RETURNING id, slot_id, name, email, status, created_at`,
      [bookingId, slot_id.trim(), trimmedName, normalizedEmail]
    );

    const row = result.rows[0];
    const booking: Booking = {
      id: row.id,
      slot_id: row.slot_id,
      name: row.name,
      email: row.email,
      status: row.status,
      created_at: formatISO(new Date(row.created_at)),
    };

    const statusCode = 201;
    const body = booking;

    if (idempotencyKey && claimed) {
      await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
    }

    res.status(statusCode).json(body);
  } catch (err: any) {
    // Handle unique constraint violation (slot already booked)
    if (err.code === '23505' && err.constraint === 'idx_bookings_slot_confirmed') {
      const statusCode = 409;
      const body = { error: 'slot already booked' };
      if (idempotencyKey && claimed) {
        await storeIdempotencyResponse(pool, idempotencyKey, statusCode, body);
      }
      return res.status(statusCode).json(body);
    }
    console.error('Create booking error:', err);
    
    // For 500 errors, delete the idempotency claim
    if (idempotencyKey && claimed) {
      await storeIdempotencyResponse(pool, idempotencyKey, 500, { error: 'internal error' });
    }
    
    res.status(500).json({ error: 'internal error' });
  }
});

// GET /bookings/:id - Get a booking by ID
bookingsRouter.get('/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return send404(res, 'booking not found');
    }

    const row = result.rows[0];
    const booking: Booking = {
      id: row.id,
      slot_id: row.slot_id,
      name: row.name,
      email: row.email,
      status: row.status,
      created_at: formatISO(new Date(row.created_at)),
    };

    res.json(booking);
  } catch (err) {
    console.error('Get booking error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// GET /bookings - List bookings by email with cursor pagination
bookingsRouter.get('/bookings', async (req: Request, res: Response) => {
  try {
    const { email, limit, cursor } = req.query;

    // Validate email
    if (!email || typeof email !== 'string' || !email.trim()) {
      return send400(res, 'invalid email');
    }

    if (!isValidEmail(email)) {
      return send400(res, 'invalid email');
    }

    const normalizedEmail = normalizeEmail(email);

    // Parse limit
    let parsedLimit = 10; // default
    if (limit) {
      parsedLimit = parseInt(limit as string, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return send400(res, 'invalid limit');
      }
    }

    // Parse cursor (base64 encoded seq)
    let cursorSeq = 0;
    if (cursor && cursor !== '') {
      try {
        const decoded = Buffer.from(cursor as string, 'base64').toString('utf-8');
        cursorSeq = parseInt(decoded, 10);
        if (isNaN(cursorSeq)) {
          return send400(res, 'invalid cursor');
        }
      } catch {
        return send400(res, 'invalid cursor');
      }
    }

    // Query bookings
    const result = await pool.query(
      `SELECT id, slot_id, name, email, status, created_at, seq
       FROM bookings
       WHERE email = $1 AND seq > $2
       ORDER BY seq ASC
       LIMIT $3`,
      [normalizedEmail, cursorSeq, parsedLimit + 1] // Fetch one extra to check if there's a next page
    );

    const hasMore = result.rows.length > parsedLimit;
    const bookings = result.rows.slice(0, parsedLimit);

    const bookingsList = bookings.map((row) => ({
      id: row.id,
      slot_id: row.slot_id,
      name: row.name,
      email: row.email,
      status: row.status,
      created_at: formatISO(new Date(row.created_at)),
      // Note: seq is NOT included in the response
    }));

    let nextCursor: string | null = null;
    if (hasMore && bookings.length > 0) {
      const lastSeq = bookings[bookings.length - 1].seq;
      nextCursor = Buffer.from(String(lastSeq)).toString('base64');
    }

    res.json({
      bookings: bookingsList,
      next_cursor: nextCursor,
    });
  } catch (err) {
    console.error('List bookings error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// DELETE /bookings/:id - Cancel a booking
bookingsRouter.delete('/bookings/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Try to cancel: UPDATE to cancelled WHERE status is confirmed, RETURNING *
    const result = await pool.query(
      `UPDATE bookings 
       SET status = 'cancelled' 
       WHERE id = $1 AND status = 'confirmed' 
       RETURNING id, slot_id, name, email, status, created_at`,
      [id]
    );

    // If a row was returned, the cancellation succeeded
    if (result.rows.length > 0) {
      const row = result.rows[0];
      const booking: Booking = {
        id: row.id,
        slot_id: row.slot_id,
        name: row.name,
        email: row.email,
        status: row.status,
        created_at: formatISO(new Date(row.created_at)),
      };
      return res.json(booking);
    }

    // No row returned - either booking doesn't exist or is already cancelled
    const checkResult = await pool.query(
      'SELECT id, status FROM bookings WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return send404(res, 'booking not found');
    }

    // Booking exists but is already cancelled
    return send409(res, 'already cancelled');
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
