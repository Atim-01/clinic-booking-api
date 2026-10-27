import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { send400 } from '../http/errors.js';

export const resetRouter = Router();

interface SlotInput {
  id: string;
  provider: string;
  start: string;
  end: string;
}

resetRouter.post('/reset', async (req: Request, res: Response) => {
  try {
    const { slots } = req.body;

    // Validate slots is an array
    if (!Array.isArray(slots)) {
      return send400(res, 'invalid slots');
    }

    // Validate each slot has required fields
    for (const slot of slots) {
      if (!slot.id || !slot.provider || !slot.start || !slot.end) {
        return send400(res, 'invalid slots');
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear all data
      await client.query('TRUNCATE bookings CASCADE');
      await client.query('DELETE FROM slots');

      // Insert new slots
      for (const slot of slots as SlotInput[]) {
        await client.query(
          'INSERT INTO slots (id, provider, start_ts, end_ts) VALUES ($1, $2, $3, $4)',
          [slot.id, slot.provider, new Date(slot.start), new Date(slot.end)]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
