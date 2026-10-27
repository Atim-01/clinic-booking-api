import { Pool } from 'pg';
import crypto from 'crypto';

interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number; // seconds to wait
}

/**
 * Check rate limit for an email using advisory lock
 * - Takes advisory lock on hash of email
 * - Counts attempts in last 60 seconds
 * - If count >= 5: return 429 with Retry-After
 * - If count < 5: insert attempt and allow
 * 
 * Important: 429 does NOT insert an attempt (waiting out Retry-After must succeed)
 */
export async function checkRateLimit(
  pool: Pool,
  email: string
): Promise<RateLimitResult> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Take advisory transaction lock on hash of email
    const emailHash = hashEmail(email);
    await client.query('SELECT pg_advisory_xact_lock($1)', [emailHash]);

    // Count attempts in last 60 seconds
    const countResult = await client.query(
      `SELECT COUNT(*) as count,
              EXTRACT(EPOCH FROM (now() - MIN(attempted_at))) as oldest_age
       FROM booking_attempts
       WHERE email = $1 AND attempted_at > now() - interval '60 seconds'`,
      [email]
    );

    const count = parseInt(countResult.rows[0].count, 10);
    const oldestAge = countResult.rows[0].oldest_age;

    if (count >= 5) {
      // Rate limit exceeded
      await client.query('COMMIT');
      
      // Calculate retry-after: time until oldest attempt ages out
      // oldestAge is how old (in seconds) the oldest attempt is
      // We want to wait until it's 60 seconds old
      const retryAfter = oldestAge !== null ? Math.ceil(60 - oldestAge) : 1;
      const safeRetryAfter = Math.max(1, retryAfter); // Minimum 1 second
      
      return {
        allowed: false,
        retryAfter: safeRetryAfter,
      };
    }

    // Insert new attempt
    await client.query(
      'INSERT INTO booking_attempts (email, attempted_at) VALUES ($1, now())',
      [email]
    );

    await client.query('COMMIT');
    
    return { allowed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Hash email to a 32-bit integer for pg_advisory_lock
 */
function hashEmail(email: string): number {
  const hash = crypto.createHash('sha256').update(email).digest();
  // Use first 4 bytes as a signed 32-bit integer
  return hash.readInt32BE(0);
}
