import { Pool } from 'pg';

interface IdempotencyResult {
  claimed: boolean;
  statusCode?: number;
  body?: any;
  shouldDelete?: boolean; // true for 429 or 500
}

/**
 * Generate fingerprint for idempotency
 * If slot_id, name, email are all strings, use JSON of those three (sorted)
 * Otherwise use canonical JSON of entire body
 */
export function generateFingerprint(body: any): string {
  const { slot_id, name, email } = body;
  
  if (
    typeof slot_id === 'string' &&
    typeof name === 'string' &&
    typeof email === 'string'
  ) {
    // Normalize: trim name, trim and lowercase email
    const normalized = {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      slot_id: slot_id.trim(),
    };
    return JSON.stringify(normalized);
  }
  
  // Otherwise, canonical JSON of entire body (sorted keys)
  return JSON.stringify(body, Object.keys(body).sort());
}

/**
 * Claim an idempotency key
 * Returns: { claimed: true } if this request won the claim
 * Returns: { claimed: false, statusCode, body } if replaying a completed request
 * Returns: { claimed: false } if polling (winner still processing)
 */
export async function claimIdempotencyKey(
  pool: Pool,
  key: string,
  fingerprint: string
): Promise<IdempotencyResult> {
  // Try to claim the key
  const insertResult = await pool.query(
    `INSERT INTO idempotency_keys (key, fingerprint, status_code, body)
     VALUES ($1, $2, NULL, NULL)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, fingerprint]
  );

  // If we inserted a row, we won the claim
  if (insertResult.rowCount && insertResult.rowCount > 0) {
    return { claimed: true };
  }

  // Key already exists - check it
  const existingResult = await pool.query(
    'SELECT fingerprint, status_code, body FROM idempotency_keys WHERE key = $1',
    [key]
  );

  if (existingResult.rows.length === 0) {
    // Race condition - key was deleted? Treat as new claim
    return { claimed: true };
  }

  const existing = existingResult.rows[0];

  // Check fingerprint match
  if (existing.fingerprint !== fingerprint) {
    // Different fingerprint = conflict
    return {
      claimed: false,
      statusCode: 422,
      body: { error: 'idempotency key conflict' },
    };
  }

  // Same fingerprint - check if response is ready
  if (existing.status_code !== null) {
    // Response ready - replay it
    return {
      claimed: false,
      statusCode: existing.status_code,
      body: existing.body,
    };
  }

  // Still processing (status_code is null) - need to poll
  return { claimed: false };
}

/**
 * Poll for idempotency key completion
 * Waits up to ~5 seconds for the winner to complete
 */
export async function pollIdempotencyKey(
  pool: Pool,
  key: string,
  maxWaitMs: number = 5000
): Promise<IdempotencyResult> {
  const startTime = Date.now();
  const pollInterval = 100; // 100ms between polls

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const result = await pool.query(
      'SELECT fingerprint, status_code, body FROM idempotency_keys WHERE key = $1',
      [key]
    );

    if (result.rows.length === 0) {
      // Key deleted - treat as error
      return {
        claimed: false,
        statusCode: 500,
        body: { error: 'internal error' },
      };
    }

    const row = result.rows[0];
    if (row.status_code !== null) {
      // Winner completed - replay response
      return {
        claimed: false,
        statusCode: row.status_code,
        body: row.body,
      };
    }
  }

  // Timeout - return 500
  return {
    claimed: false,
    statusCode: 500,
    body: { error: 'internal error' },
  };
}

/**
 * Store the response for an idempotency key
 * For 429 or 500, delete the claim instead of storing
 */
export async function storeIdempotencyResponse(
  pool: Pool,
  key: string,
  statusCode: number,
  body: any
): Promise<void> {
  // For 429 or 500, delete the claim
  if (statusCode === 429 || statusCode === 500) {
    await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
    return;
  }

  // Store the response
  await pool.query(
    'UPDATE idempotency_keys SET status_code = $1, body = $2 WHERE key = $3',
    [statusCode, body, key]
  );
}
