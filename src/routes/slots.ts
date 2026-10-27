import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { formatISO } from '../time.js';

export const slotsRouter = Router();

interface SlotWithAvailability {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
}

slotsRouter.get('/slots', async (req: Request, res: Response) => {
  try {
    const { provider } = req.query;

    let query = `
      SELECT 
        s.id, 
        s.provider, 
        s.start_ts, 
        s.end_ts,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM bookings b 
            WHERE b.slot_id = s.id AND b.status = 'confirmed'
          ) THEN false 
          ELSE true 
        END as available
      FROM slots s
    `;

    const params: any[] = [];
    if (provider) {
      query += ' WHERE s.provider = $1';
      params.push(provider);
    }

    query += ' ORDER BY s.start_ts ASC';

    const result = await pool.query(query, params);

    const slots: SlotWithAvailability[] = result.rows.map(row => ({
      id: row.id,
      provider: row.provider,
      start: formatISO(new Date(row.start_ts)),
      end: formatISO(new Date(row.end_ts)),
      available: row.available,
    }));

    res.json({ slots });
  } catch (err) {
    console.error('Get slots error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});
