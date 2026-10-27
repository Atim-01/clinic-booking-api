import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { app } from '../src/app.js';

describe('Commit 0: Express scaffold', () => {
  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  });

  it('Unknown route returns 404 not found', async () => {
    const res = await request(app).get('/unknown').set('X-API-Key', 'test-api-key-for-testing');
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(res.body, { error: 'not found' });
  });

  it('Malformed JSON returns 400 invalid json', async () => {
    const res = await request(app)
      .post('/bookings')
      .set('Content-Type', 'application/json')
      .set('X-API-Key', 'test-api-key-for-testing')
      .send('{');
    assert.strictEqual(res.status, 400);
    assert.deepStrictEqual(res.body, { error: 'invalid json' });
  });
});
