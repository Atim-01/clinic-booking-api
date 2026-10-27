import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../src/app.js';
import { initSchema } from '../src/db.js';

const API_KEY = 'test-api-key-for-testing';

describe('Commit 2: Level 2 - API key auth and validation', () => {
  before(async () => {
    await initSchema();
    // Clear database before these tests
    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });
  });

  it('GET /slots without API key returns 401', async () => {
    const res = await request(app).get('/slots');
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });

  it('POST /bookings without API key returns 401', async () => {
    const res = await request(app).post('/bookings').send({
      slot_id: 'slot-1',
      name: 'Test',
      email: 'test@example.com',
    });
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });

  it('GET /health does not require API key', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  });

  it('OPTIONS request does not require API key', async () => {
    const res = await request(app).options('/slots');
    assert.ok(res.status === 204 || res.status === 200);
  });

  it('Malformed JSON without API key returns 401', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Content-Type', 'application/json')
      .send('{invalid');
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'unauthorized' });
  });

  it('Malformed JSON with valid API key returns 400 invalid json', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Content-Type', 'application/json')
      .set('X-API-Key', API_KEY)
      .send('{invalid');
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid json' });
  });

  it('POST /bookings with empty name returns 400 invalid booking', async () => {
    const slots = [
      {
        id: 'c2-slot-auth-1',
        provider: 'Dr. Test',
        start: '2026-12-20T10:00:00Z',
        end: '2026-12-20T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c2-slot-auth-1',
        name: '',
        email: 'valid@example.com',
      });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid booking' });
  });

  it('POST /bookings with empty email returns 400 invalid booking', async () => {
    const slots = [
      {
        id: 'c2-slot-auth-2',
        provider: 'Dr. Test',
        start: '2026-12-20T11:00:00Z',
        end: '2026-12-20T11:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c2-slot-auth-2',
        name: 'Valid Name',
        email: '',
      });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid booking' });
  });

  it('POST /bookings with invalid email format returns 400 invalid booking', async () => {
    const slots = [
      {
        id: 'c2-slot-auth-3',
        provider: 'Dr. Test',
        start: '2026-12-20T12:00:00Z',
        end: '2026-12-20T12:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    // No @ symbol
    let res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c2-slot-auth-3',
        name: 'Valid Name',
        email: 'notanemail',
      });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid booking' });

    // No dot in domain
    res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c2-slot-auth-3',
        name: 'Valid Name',
        email: 'test@nodot',
      });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid booking' });
  });

  it('POST /bookings with unknown slot_id returns 404 slot not found', async () => {
    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots: [] });

    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'unknown-slot',
        name: 'Valid Name',
        email: 'valid@example.com',
      });

    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'slot not found' });
  });

  it('POST /bookings with past slot returns 400 slot already started', async () => {
    const slots = [
      {
        id: 'c2-slot-past',
        provider: 'Dr. Past',
        start: '2020-01-01T09:00:00Z', // Past date
        end: '2020-01-01T09:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c2-slot-past',
        name: 'Valid Name',
        email: 'valid@example.com',
      });

    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'slot already started' });
  });

  it('Valid booking with API key succeeds', async () => {
    const slots = [
      {
        id: 'c2-slot-valid',
        provider: 'Dr. Valid',
        start: '2026-12-25T10:00:00Z',
        end: '2026-12-25T10:30:00Z',
      },
    ];

    await request(app).post('/reset').set('X-API-Key', API_KEY).send({ slots });

    const res = await request(app)
      .post('/bookings')
      .set('X-API-Key', API_KEY)
      .send({
        slot_id: 'c2-slot-valid',
        name: '  John Doe  ', // Test trimming
        email: '  JOHN@EXAMPLE.COM  ', // Test normalization
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.name, 'John Doe');
    assert.strictEqual(res.body.email, 'john@example.com');
  });
});
