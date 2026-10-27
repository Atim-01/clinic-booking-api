import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSchema } from '../src/db.js';

const API_KEY = 'test-api-key-for-testing';

describe('Commit 1: Level 1 - Basic booking functionality', () => {
  before(async () => {
    // Initialize schema before tests
    await initSchema();
    // Clear database before these tests
    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });
  });

  it('POST /reset with slots then GET /slots returns ordered slots with available: true', async () => {
    const slots = [
      {
        id: 'c1-slot-1',
        provider: 'Dr. Smith',
        start: '2026-12-10T09:00:00Z',
        end: '2026-12-10T09:30:00Z',
      },
      {
        id: 'c1-slot-2',
        provider: 'Dr. Jones',
        start: '2026-12-10T10:00:00Z',
        end: '2026-12-10T10:30:00Z',
      },
    ];

    // Reset with slots
    const resetRes = await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });
    assert.strictEqual(resetRes.status, 200);
    assert.deepStrictEqual(resetRes.body, { ok: true });

    // Get slots
    const getRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.slots.length, 2);
    assert.strictEqual(getRes.body.slots[0].id, 'c1-slot-1');
    assert.strictEqual(getRes.body.slots[0].available, true);
    assert.strictEqual(getRes.body.slots[0].start, '2026-12-10T09:00:00Z');
    assert.strictEqual(getRes.body.slots[1].id, 'c1-slot-2');
  });

  it('POST /bookings creates confirmed booking with no .000 in timestamp', async () => {
    const slots = [
      {
        id: 'c1-slot-3',
        provider: 'Dr. Adams',
        start: '2026-12-11T14:00:00Z',
        end: '2026-12-11T14:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const bookRes = await request(app).post('/bookings').set('X-API-Key', API_KEY).send({
      slot_id: 'c1-slot-3',
      name: 'John Doe',
      email: 'john@example.com',
    });

    assert.strictEqual(bookRes.status, 201);
    assert.strictEqual(bookRes.body.slot_id, 'c1-slot-3');
    assert.strictEqual(bookRes.body.name, 'John Doe');
    assert.strictEqual(bookRes.body.email, 'john@example.com');
    assert.strictEqual(bookRes.body.status, 'confirmed');
    assert.ok(bookRes.body.id);
    assert.ok(bookRes.body.created_at);
    // Verify no .000 in timestamp (or if there are non-zero ms, that's OK too)
    assert.ok(!bookRes.body.created_at.includes('.000Z'));
    // Verify seq is NOT in the response
    assert.strictEqual(bookRes.body.seq, undefined);
  });

  it('GET /bookings/:id returns the booking', async () => {
    const slots = [
      {
        id: 'c1-slot-4',
        provider: 'Dr. Lee',
        start: '2026-12-12T11:00:00Z',
        end: '2026-12-12T11:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const bookRes = await request(app).post('/bookings').set('X-API-Key', API_KEY).send({
      slot_id: 'c1-slot-4',
      name: 'Jane Smith',
      email: 'jane@example.com',
    });

    const bookingId = bookRes.body.id;

    const getRes = await request(app).get(`/bookings/${bookingId}`).set('X-API-Key', API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.id, bookingId);
    assert.strictEqual(getRes.body.name, 'Jane Smith');
    assert.strictEqual(getRes.body.seq, undefined); // seq not in JSON
  });

  it('GET /bookings/:id for unknown booking returns 404', async () => {
    const getRes = await request(app).get('/bookings/unknown-id').set('X-API-Key', API_KEY);
    assert.strictEqual(getRes.status, 404);
    assert.deepStrictEqual(getRes.body, { error: 'booking not found' });
  });

  it('POST /reset wipes bookings and replaces slots', async () => {
    const slots1 = [
      {
        id: 'c1-slot-5',
        provider: 'Dr. Green',
        start: '2026-12-13T09:00:00Z',
        end: '2026-12-13T09:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: slots1 });
    await request(app).post('/bookings').set('X-API-Key', API_KEY).send({
      slot_id: 'c1-slot-5',
      name: 'User One',
      email: 'user1@example.com',
    });

    // Reset again with different slots
    const slots2 = [
      {
        id: 'c1-slot-6',
        provider: 'Dr. Blue',
        start: '2026-12-14T10:00:00Z',
        end: '2026-12-14T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: slots2 });

    // Old slot should be gone
    const slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
    assert.strictEqual(slotsRes.body.slots.length, 1);
    assert.strictEqual(slotsRes.body.slots[0].id, 'c1-slot-6');
  });

  it('POST /reset without slots array returns 400 invalid slots', async () => {
    const res = await request(app).post('/reset').set('X-API-Key', API_KEY).send({});
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid slots' });
  });

  it('POST /reset with empty slots array clears catalog', async () => {
    const slots = [
      {
        id: 'c1-slot-7',
        provider: 'Dr. White',
        start: '2026-12-15T09:00:00Z',
        end: '2026-12-15T09:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // Reset with empty array
    const resetRes = await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });
    assert.strictEqual(resetRes.status, 200);

    // Slots should be empty
    const slotsRes = await request(app).get('/slots').set('X-API-Key', API_KEY);
    assert.strictEqual(slotsRes.body.slots.length, 0);
  });

  it('POST /reset with incomplete slot returns 400 invalid slots', async () => {
    const slots = [
      {
        id: 'c1-slot-8',
        provider: 'Dr. Red',
        start: '2026-12-16T09:00:00Z',
        // missing end
      },
    ];

    const res = await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid slots' });
  });
});
