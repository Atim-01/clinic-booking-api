import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSchema, pool } from '../src/db.js';
import { randomUUID } from 'crypto';

const API_KEY = 'test-api-key-for-testing';

describe('Commit 5: Level 5 - Rate limiting', () => {
  before(async () => {
    await initSchema();
    // Clear database before these tests
    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });
  });

  it('5 valid attempts with same email, then 6th returns 429', async () => {
    const slots = Array.from({ length: 6 }, (_, i) => ({
      id: `c5-slot-${i}`,
      provider: 'Dr. Limit',
      start: `2026-12-24T${10 + i}:00:00Z`,
      end: `2026-12-24T${10 + i}:30:00Z`,
    }));

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'ratelimit@example.com';

    // First 5 attempts should succeed (even if they 400 for empty name)
    // The spec says: "Count failed attempts that have a valid email"
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: `c5-slot-${i}`,
          name: '', // Invalid name - will 400 but count toward rate limit
          email,
        });
      
      // Should get 400 for invalid booking (empty name)
      assert.strictEqual(res.status, 400);
    }

    // 6th attempt should be rate limited
    const res6 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-5',
        name: 'Valid Name',
        email,
      });

    assert.strictEqual(res6.status, 429);
    assert.deepStrictEqual(res6.body, { error: 'too many attempts' });
    assert.ok(res6.headers['retry-after']);
    const retryAfter = parseInt(res6.headers['retry-after'], 10);
    assert.ok(retryAfter >= 1);
  });

  it('After waiting Retry-After, can book again', async () => {
    // Insert an old attempt to simulate time passing
    const email = 'waitout@example.com';
    
    // Insert 5 attempts, with the oldest one being 61 seconds ago
    await pool.query(
      `INSERT INTO booking_attempts (email, attempted_at) 
       VALUES ($1, now() - interval '61 seconds')`,
      [email]
    );
    for (let i = 0; i < 4; i++) {
      await pool.query(
        'INSERT INTO booking_attempts (email, attempted_at) VALUES ($1, now())',
        [email]
      );
    }

    const slots = [
      {
        id: 'c5-slot-wait',
        provider: 'Dr. Wait',
        start: '2026-12-24T14:00:00Z',
        end: '2026-12-24T14:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // Next attempt should succeed (oldest aged out)
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-wait',
        name: 'Valid Name',
        email,
      });

    assert.strictEqual(res.status, 201);
  });

  it('Rate limit is per-email: different email still allows booking', async () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({
      id: `c5-slot-other-${i}`,
      provider: 'Dr. PerEmail',
      start: `2026-12-24T${String(10 + i).padStart(2, '0')}:00:00Z`,
      end: `2026-12-24T${String(10 + i).padStart(2, '0')}:30:00Z`,
    }));

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email1 = 'user1@example.com';
    const email2 = 'user2@example.com';

    // Use up email1's quota (5 attempts - these will insert into booking_attempts)
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: `c5-slot-other-${i}`,
          name: '',
          email: email1,
        });
    }

    // email1 should be rate limited
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-other-5',
        name: 'Name',
        email: email1,
      });
    assert.strictEqual(res1.status, 429);

    // email2 should still work
    const res2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-other-6',
        name: 'Name',
        email: email2,
      });
    assert.strictEqual(res2.status, 201);
  });

  it('Replay of successful idempotent booking does NOT count toward rate limit', async () => {
    const slots = [
      {
        id: 'c5-slot-replay',
        provider: 'Dr. Replay',
        start: '2026-12-25T10:00:00Z',
        end: '2026-12-25T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'replay@example.com';
    const idempotencyKey = randomUUID();

    // First request - succeeds and counts as 1 attempt
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slot_id: 'c5-slot-replay',
        name: 'Replay User',
        email,
      });
    assert.strictEqual(res1.status, 201);

    // Replay same request multiple times (should NOT add to rate limit)
    for (let i = 0; i < 10; i++) {
      const replay = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          slot_id: 'c5-slot-replay',
          name: 'Replay User',
          email,
        });
      assert.strictEqual(replay.status, 201);
      assert.strictEqual(replay.body.id, res1.body.id);
    }

    // Check that only 1 attempt was recorded (not 11)
    const attempts = await pool.query(
      'SELECT COUNT(*) FROM booking_attempts WHERE email = $1',
      [email]
    );
    assert.strictEqual(parseInt(attempts.rows[0].count), 1);
  });

  it('Invalid email (no @ or no dot) never triggers rate limit', async () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({
      id: `c5-slot-invalid-${i}`,
      provider: 'Dr. Invalid',
      start: `2026-12-25T${11 + i}:00:00Z`,
      end: `2026-12-25T${11 + i}:30:00Z`,
    }));

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // 10 attempts with invalid email - should all return 400, none should 429
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: `c5-slot-invalid-${i}`,
          name: 'Name',
          email: 'notanemail', // No @
        });
      assert.strictEqual(res.status, 400);
      assert.deepStrictEqual(res.body, { error: 'invalid booking' });
    }
  });

  it('Missing email never triggers rate limit', async () => {
    const slots = Array.from({ length: 10 }, (_, i) => ({
      id: `c5-slot-missing-${i}`,
      provider: 'Dr. Missing',
      start: `2026-12-25T${12 + i}:00:00Z`,
      end: `2026-12-25T${12 + i}:30:00Z`,
    }));

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // 10 attempts with missing email - should all return 400
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: `c5-slot-missing-${i}`,
          name: 'Name',
          // email missing
        });
      assert.strictEqual(res.status, 400);
      assert.deepStrictEqual(res.body, { error: 'invalid booking' });
    }
  });

  it('Retry-After header is a whole number >= 1', async () => {
    const slots = [
      {
        id: 'c5-slot-retry',
        provider: 'Dr. Retry',
        start: '2026-12-26T10:00:00Z',
        end: '2026-12-26T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'retryafter@example.com';

    // Insert 5 attempts AFTER reset
    for (let i = 0; i < 5; i++) {
      await pool.query(
        'INSERT INTO booking_attempts (email, attempted_at) VALUES ($1, now())',
        [email]
      );
    }

    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-retry',
        name: 'Name',
        email,
      });

    assert.strictEqual(res.status, 429);
    const retryAfter = parseInt(res.headers['retry-after'], 10);
    assert.ok(!isNaN(retryAfter));
    assert.ok(retryAfter >= 1);
    assert.ok(Number.isInteger(retryAfter));
  });

  it('429 does NOT insert a booking_attempts row', async () => {
    const slots = [
      {
        id: 'c5-slot-no-row',
        provider: 'Dr. NoRow',
        start: '2026-12-26T11:00:00Z',
        end: '2026-12-26T11:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'no429row@example.com';

    // Insert 5 attempts AFTER reset
    for (let i = 0; i < 5; i++) {
      await pool.query(
        'INSERT INTO booking_attempts (email, attempted_at) VALUES ($1, now())',
        [email]
      );
    }

    // Attempt that will be 429'd
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-no-row',
        name: 'Name',
        email,
      });

    assert.strictEqual(res.status, 429);

    // Check that still only 5 attempts (429 didn't insert)
    const attempts = await pool.query(
      'SELECT COUNT(*) FROM booking_attempts WHERE email = $1',
      [email]
    );
    assert.strictEqual(parseInt(attempts.rows[0].count), 5);
  });

  it('Successful bookings (201) count toward rate limit', async () => {
    const slots = Array.from({ length: 6 }, (_, i) => ({
      id: `c5-slot-success-${i}`,
      provider: 'Dr. Success',
      start: `2026-12-26T${12 + i}:00:00Z`,
      end: `2026-12-26T${12 + i}:30:00Z`,
    }));

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'success@example.com';

    // 5 successful bookings
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: `c5-slot-success-${i}`,
          name: 'Success User',
          email,
        });
      assert.strictEqual(res.status, 201);
    }

    // 6th should be rate limited
    const res6 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c5-slot-success-5',
        name: 'Success User',
        email,
      });

    assert.strictEqual(res6.status, 429);
  });
});
