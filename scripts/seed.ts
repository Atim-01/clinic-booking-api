import { pool, initSchema } from '../src/db.js';
import '../src/config.js'; // Load env vars

/**
 * Seed script: creates demo slots with future dates
 * Run explicitly with: npm run seed
 * Not invoked on app boot - use /reset for checker tests
 */

async function seed() {
  try {
    console.log('Initializing schema...');
    await initSchema();

    console.log('Clearing existing data...');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE bookings CASCADE');
      await client.query('DELETE FROM slots');
      await client.query('DELETE FROM idempotency_keys');
      await client.query('DELETE FROM booking_attempts');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log('Creating demo slots...');
    
    // Create slots for the next 7 days, two providers, multiple time slots per day
    const providers = ['Dr. Sarah Johnson', 'Dr. Michael Chen'];
    const slots: Array<{ id: string; provider: string; start: Date; end: Date }> = [];
    
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() + 1); // Start tomorrow
    startDate.setHours(9, 0, 0, 0); // 9 AM

    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + day);

      // Skip weekends for this demo
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      // Create slots from 9 AM to 5 PM (8 hours * 2 slots per hour = 16 slots per day)
      for (let hour = 9; hour < 17; hour++) {
        for (let minute of [0, 30]) {
          for (const provider of providers) {
            const slotStart = new Date(date);
            slotStart.setHours(hour, minute, 0, 0);

            const slotEnd = new Date(slotStart);
            slotEnd.setMinutes(slotEnd.getMinutes() + 30);

            const slotId = `slot-${date.toISOString().split('T')[0]}-${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}-${provider.split(' ')[1].toLowerCase()}`;

            slots.push({
              id: slotId,
              provider,
              start: slotStart,
              end: slotEnd,
            });
          }
        }
      }
    }

    // Insert all slots
    for (const slot of slots) {
      await pool.query(
        'INSERT INTO slots (id, provider, start_ts, end_ts) VALUES ($1, $2, $3, $4)',
        [slot.id, slot.provider, slot.start, slot.end]
      );
    }

    console.log(`✓ Created ${slots.length} demo slots`);
    console.log(`  Providers: ${providers.join(', ')}`);
    console.log(`  Date range: ${slots[0].start.toISOString().split('T')[0]} to ${slots[slots.length - 1].start.toISOString().split('T')[0]}`);
    console.log(`  Time range: 9:00 AM to 5:00 PM (weekdays only)`);
    console.log(`  Slot duration: 30 minutes`);
    console.log('\nSeed complete! Your API is ready for demo.');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
