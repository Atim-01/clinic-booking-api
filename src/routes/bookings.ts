import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { generateBookingId } from '../ids.js';
import { formatISO } from '../time.js';
import { send404 } from '../http/errors.js';

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

    const bookingId = generateBookingId();
    const trimmedName = name?.trim();
    const trimmedEmail = email?.trim().toLowerCase();

    const result = await pool.query(
      `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
       VALUES ($1, $2, $3, $4, 'confirmed', now())
       RETURNING id, slot_id, name, email, status, created_at`,
      [bookingId, slot_id, trimmedName, trimmedEmail]
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
  } catch (err) {
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
