import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSchema } from '../src/db.js';

const API_KEY = 'test-api-key-for-testing';

describe('Commit 3: Level 3 - Exclusive slots and cancel', () => {
  before(async () => {
    await initSchema();
    // Clear database before these tests
    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });
  });

  it('Second booking for same slot returns 409 slot already booked', async () => {
    const slots = [
      {
        id: 'c3-slot-1',
        provider: 'Dr. Exclusive',
        start: '2026-12-20T14:00:00Z',
        end: '2026-12-20T14:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // First booking should succeed
    const res1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c3-slot-1',
        name: 'Alice',
        email: 'alice@example.com',
      });

    assert.strictEqual(res1.status, 201);

    // Second booking should fail with 409
    const res2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c3-slot-1',
        name: 'Bob',
        email: 'bob@example.com',
      });

    assert.strictEqual(res2.status, 409);
    assert.deepStrictEqual(res2.body, { error: 'slot already booked' });
  });

  it('Concurrent bookings for same slot: one succeeds, one gets 409', async () => {
    const slots = [
      {
        id: 'c3-slot-2',
        provider: 'Dr. Race',
        start: '2026-12-20T15:00:00Z',
        end: '2026-12-20T15:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // Fire two requests simultaneously
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'c3-slot-2',
          name: 'User1',
          email: 'user1@example.com',
        }),
      request(app)
        .post('/bookings')
        .set('X-API-Key', API_KEY)
        .send({
          slot_id: 'c3-slot-2',
          name: 'User2',
          email: 'user2@example.com',
        }),
    ]);

    // One should be 201, the other 409
    const statuses = [res1.status, res2.status].sort();
    assert.deepStrictEqual(statuses, [201, 409]);
  });

  it('DELETE /bookings/:id cancels a confirmed booking', async () => {
    const slots = [
      {
        id: 'c3-slot-3',
        provider: 'Dr. Cancel',
        start: '2026-12-20T16:00:00Z',
        end: '2026-12-20T16:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const bookRes = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c3-slot-3',
        name: 'Charlie',
        email: 'charlie@example.com',
      });

    const bookingId = bookRes.body.id;

    // Cancel the booking
    const cancelRes = await request(app)
      .delete(`/bookings/${bookingId}`)
      .set('X-API-Key', API_KEY);

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.id, bookingId);
    assert.strictEqual(cancelRes.body.status, 'cancelled');
  });

  it('DELETE /bookings/:id for already cancelled returns 409', async () => {
    const slots = [
      {
        id: 'c3-slot-4',
        provider: 'Dr. DoubleCancel',
        start: '2026-12-20T17:00:00Z',
        end: '2026-12-20T17:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const bookRes = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c3-slot-4',
        name: 'Diana',
        email: 'diana@example.com',
      });

    const bookingId = bookRes.body.id;

    // First cancel
    await request(app).delete(`/bookings/${bookingId}`).set('X-API-Key', API_KEY);

    // Second cancel should return 409
    const res = await request(app)
      .delete(`/bookings/${bookingId}`)
      .set('X-API-Key', API_KEY);

    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, { error: 'already cancelled' });
  });

  it('DELETE /bookings/:id for missing booking returns 404', async () => {
    const res = await request(app)
      .delete('/bookings/nonexistent-id')
      .set('X-API-Key', API_KEY);

    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'booking not found' });
  });

  it('After cancel, slot becomes available and can be booked again', async () => {
    const slots = [
      {
        id: 'c3-slot-5',
        provider: 'Dr. Rebook',
        start: '2026-12-20T18:00:00Z',
        end: '2026-12-20T18:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // First booking
    const bookRes1 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c3-slot-5',
        name: 'Eve',
        email: 'eve@example.com',
      });

    assert.strictEqual(bookRes1.status, 201);

    // Check slot is not available
    let slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
    const slot = slotsRes.body.slots.find((s: any) => s.id === 'c3-slot-5');
    assert.strictEqual(slot.available, false);

    // Cancel the booking
    await request(app)
      .delete(`/bookings/${bookRes1.body.id}`)
      .set('X-API-Key', API_KEY);

    // Check slot is available again
    slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
    const slotAfter = slotsRes.body.slots.find((s: any) => s.id === 'c3-slot-5');
    assert.strictEqual(slotAfter.available, true);

    // Book again - should succeed
    const bookRes2 = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c3-slot-5',
        name: 'Frank',
        email: 'frank@example.com',
      });

    assert.strictEqual(bookRes2.status, 201);
  });
});
