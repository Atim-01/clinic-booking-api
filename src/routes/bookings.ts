import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { generateBookingId } from '../ids.js';
import { formatISO } from '../time.js';
import { send404, send400, send409 } from '../http/errors.js';
import { isValidEmail, normalizeEmail } from '../lib/email.js';

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
  try {
    const { slot_id, name, email } = req.body;

    // Validate required fields
    if (!slot_id || typeof slot_id !== 'string' || !slot_id.trim()) {
      return send400(res, 'invalid booking');
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return send400(res, 'invalid booking');
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      return send400(res, 'invalid booking');
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return send400(res, 'invalid booking');
    }

    const trimmedName = name.trim();
    const normalizedEmail = normalizeEmail(email);

    // Check if slot exists
    const slotResult = await pool.query(
      'SELECT id, start_ts FROM slots WHERE id = $1',
      [slot_id.trim()]
    );

    if (slotResult.rows.length === 0) {
      return send404(res, 'slot not found');
    }

    const slot = slotResult.rows[0];
    const slotStart = new Date(slot.start_ts);
    const now = new Date();

    // Check if slot has already started
    if (now >= slotStart) {
      return send400(res, 'slot already started');
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

    res.status(201).json(booking);
  } catch (err: any) {
    // Handle unique constraint violation (slot already booked)
    if (err.code === '23505' && err.constraint === 'idx_bookings_slot_confirmed') {
      return send409(res, 'slot already booked');
    }
    console.error('Create booking error:', err);
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
