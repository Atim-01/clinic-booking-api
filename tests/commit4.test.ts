import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSchema, pool } from '../src/db.js';
import { randomUUID } from 'crypto';

const API_KEY = 'test-api-key-for-testing';

describe('Commit 4: Level 4 - Idempotency and cursor pagination', () => {
  before(async () => {
    await initSchema();
    // Clear database before these tests
    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });
  });

  it('Same idempotency key with same body returns same booking twice', async () => {
    const slots = [
      {
        id: 'c4-slot-1',
        provider: 'Dr. Idem',
        start: '2026-12-21T10:00:00Z',
        end: '2026-12-21T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const idempotencyKey = randomUUID();
    const bookingData = {
      slot_id: 'c4-slot-1',
      name: 'Alice',
      email: 'alice@example.com',
    };

    // First request
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send(bookingData);

    assert.strictEqual(res1.status, 201);
    const bookingId = res1.body.id;

    // Second request with same key and body - should return same booking
    const res2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send(bookingData);

    assert.strictEqual(res2.status, 201);
    assert.strictEqual(res2.body.id, bookingId);

    // Verify only one booking was created
    const allBookings = await pool.query('SELECT COUNT(*) FROM bookings');
    assert.strictEqual(parseInt(allBookings.rows[0].count), 1);
  });

  it('Same idempotency key with different body returns 422', async () => {
    const slots = [
      {
        id: 'c4-slot-2',
        provider: 'Dr. Conflict',
        start: '2026-12-21T11:00:00Z',
        end: '2026-12-21T11:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const idempotencyKey = randomUUID();

    // First request
    await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slot_id: 'c4-slot-2',
        name: 'Bob',
        email: 'bob@example.com',
      });

    // Second request with same key but different body
    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slot_id: 'c4-slot-2',
        name: 'Charlie', // Different name
        email: 'charlie@example.com', // Different email
      });

    assert.strictEqual(res.status, 422);
    assert.deepStrictEqual(res.body, { error: 'idempotency key conflict' });
  });

  it('Concurrent requests with same idempotency key create one booking', async () => {
    const slots = [
      {
        id: 'c4-slot-3',
        provider: 'Dr. Concurrent',
        start: '2026-12-21T12:00:00Z',
        end: '2026-12-21T12:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const idempotencyKey = randomUUID();
    const bookingData = {
      slot_id: 'c4-slot-3',
      name: 'Diana',
      email: 'diana@example.com',
    };

    // Fire two concurrent requests with same key
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send(bookingData),
      request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .set('Idempotency-Key', idempotencyKey)
        .send(bookingData),
    ]);

    // Both should be 201 (loser polls and gets winner's result)
    assert.strictEqual(res1.status, 201);
    assert.strictEqual(res2.status, 201);
    
    // Same booking ID
    assert.strictEqual(res1.body.id, res2.body.id);

    // Only one booking created
    const allBookings = await pool.query('SELECT COUNT(*) FROM bookings WHERE email = $1', [
      'diana@example.com',
    ]);
    assert.strictEqual(parseInt(allBookings.rows[0].count), 1);
  });

  it('GET /bookings returns bookings ordered by seq, oldest first', async () => {
    const slots = [
      {
        id: 'c4-slot-4a',
        provider: 'Dr. List',
        start: '2026-12-21T13:00:00Z',
        end: '2026-12-21T13:30:00Z',
      },
      {
        id: 'c4-slot-4b',
        provider: 'Dr. List',
        start: '2026-12-21T14:00:00Z',
        end: '2026-12-21T14:30:00Z',
      },
      {
        id: 'c4-slot-4c',
        provider: 'Dr. List',
        start: '2026-12-21T15:00:00Z',
        end: '2026-12-21T15:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'eve@example.com';

    // Create three bookings
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: 'c4-slot-4a', name: 'Eve', email });

    const res2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: 'c4-slot-4b', name: 'Eve', email });

    const res3 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: 'c4-slot-4c', name: 'Eve', email });

    // List bookings
    const listRes = await request(app)
      .get('/bookings')
      .query({ email })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.bookings.length, 3);
    
    // Check order (oldest first = first booking first)
    assert.strictEqual(listRes.body.bookings[0].id, res1.body.id);
    assert.strictEqual(listRes.body.bookings[1].id, res2.body.id);
    assert.strictEqual(listRes.body.bookings[2].id, res3.body.id);

    // Verify seq is NOT in response
    assert.strictEqual(listRes.body.bookings[0].seq, undefined);
  });

  it('GET /bookings with cursor paginates correctly', async () => {
    const slots = Array.from({ length: 5 }, (_, i) => ({
      id: `c4-slot-5-${i}`,
      provider: 'Dr. Page',
      start: `2026-12-22T${10 + i}:00:00Z`,
      end: `2026-12-22T${10 + i}:30:00Z`,
    }));

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'frank@example.com';

    // Create 5 bookings
    const bookingIds = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({ slot_id: `c4-slot-5-${i}`, name: 'Frank', email });
      bookingIds.push(res.body.id);
    }

    // First page (limit 2)
    const page1 = await request(app)
      .get('/bookings')
      .query({ email, limit: 2 })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(page1.status, 200);
    assert.strictEqual(page1.body.bookings.length, 2);
    assert.strictEqual(page1.body.bookings[0].id, bookingIds[0]);
    assert.strictEqual(page1.body.bookings[1].id, bookingIds[1]);
    assert.ok(page1.body.next_cursor);

    // Second page
    const page2 = await request(app)
      .get('/bookings')
      .query({ email, limit: 2, cursor: page1.body.next_cursor })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(page2.status, 200);
    assert.strictEqual(page2.body.bookings.length, 2);
    assert.strictEqual(page2.body.bookings[0].id, bookingIds[2]);
    assert.strictEqual(page2.body.bookings[1].id, bookingIds[3]);
    assert.ok(page2.body.next_cursor);

    // Third page (last)
    const page3 = await request(app)
      .get('/bookings')
      .query({ email, limit: 2, cursor: page2.body.next_cursor })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(page3.status, 200);
    assert.strictEqual(page3.body.bookings.length, 1);
    assert.strictEqual(page3.body.bookings[0].id, bookingIds[4]);
    assert.strictEqual(page3.body.next_cursor, null); // No more pages
  });

  it('GET /bookings with invalid limit returns 400', async () => {
    const res = await request(app)
      .get('/bookings')
      .query({ email: 'test@example.com', limit: 0 })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid limit' });
  });

  it('GET /bookings with missing email returns 400', async () => {
    const res = await request(app).get('/bookings').set('X-API-Key', API_KEY);

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid email' });
  });

  it('GET /bookings with invalid cursor returns 400', async () => {
    const res = await request(app)
      .get('/bookings')
      .query({ email: 'test@example.com', cursor: 'invalid-cursor!' })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid cursor' });
  });

  it('GET /bookings includes cancelled bookings', async () => {
    const slots = [
      {
        id: 'c4-slot-6',
        provider: 'Dr. Cancel',
        start: '2026-12-23T10:00:00Z',
        end: '2026-12-23T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const email = 'george@example.com';

    // Create and cancel a booking
    const bookRes = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({ slot_id: 'c4-slot-6', name: 'George', email });

    await request(app)
      .delete(`/bookings/${bookRes.body.id}`)
      .set('X-API-Key', API_KEY);

    // List should include cancelled booking
    const listRes = await request(app)
      .get('/bookings')
      .query({ email })
      .set('X-API-Key', API_KEY);

    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.bookings.length, 1);
    assert.strictEqual(listRes.body.bookings[0].status, 'cancelled');
  });

  it('Idempotency key replay works for different response codes', async () => {
    const slots = [
      {
        id: 'c4-slot-7',
        provider: 'Dr. Replay',
        start: '2026-12-23T11:00:00Z',
        end: '2026-12-23T11:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const idempotencyKey = randomUUID();

    // First request - invalid (empty name) - should get 400
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slot_id: 'c4-slot-7',
        name: '',
        email: 'test@example.com',
      });

    assert.strictEqual(res1.status, 400);
    assert.deepStrictEqual(res1.body, { error: 'invalid booking' });

    // Second request with same key - should replay the 400
    const res2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slot_id: 'c4-slot-7',
        name: '',
        email: 'test@example.com',
      });

    assert.strictEqual(res2.status, 400);
    assert.deepStrictEqual(res2.body, { error: 'invalid booking' });
  });
});
