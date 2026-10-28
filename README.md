# Clinic Booking API

REST API for booking clinic appointment slots with healthcare providers. Built with Node.js, Express, TypeScript, and PostgreSQL.

## Features

### Level 0: Foundation
- ✅ Express + TypeScript scaffold
- ✅ PostgreSQL database with connection pooling
- ✅ Health check endpoint
- ✅ CORS configuration
- ✅ Error handling middleware

### Level 1: Core Functionality
- ✅ View available appointment slots (GET /slots)
- ✅ Book appointments (POST /bookings)
- ✅ Cancel bookings (DELETE /bookings/:id)
- ✅ List bookings by email (GET /bookings?email=...)
- ✅ Cursor-based pagination for bookings
- ✅ Reset endpoint for testing (POST /reset)

### Level 2: Security & Validation
- ✅ API key authentication
- ✅ Input validation (email format, slot selection)
- ✅ Protected routes

### Level 3: Concurrency Safety
- ✅ Partial unique index prevents double-booking
- ✅ Atomic booking operations
- ✅ 409 Conflict on duplicate bookings
- ✅ Soft deletes (UPDATE instead of DELETE)

### Level 4: Idempotency & Reliability
- ✅ Idempotency key support (POST /bookings)
- ✅ Claim-and-poll pattern
- ✅ Fingerprint matching
- ✅ GET /bookings with cursor pagination

### Level 5: Rate Limiting
- ✅ Per-email rate limiting (5 attempts per 60 seconds)
- ✅ PostgreSQL advisory locks
- ✅ 429 Too Many Requests with Retry-After header

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+

### Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Create database:**
```bash
# Create database
psql -U postgres -c "CREATE DATABASE clinic_booking;"

# Create test database
psql -U postgres -c "CREATE DATABASE clinic_test WITH OWNER test;"
psql -U postgres -c "CREATE USER test WITH PASSWORD 'test';"
```

3. **Configure environment:**
```bash
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/clinic_booking
API_KEY=your-random-api-key-here
CORS_ORIGIN=http://localhost:5173
```

Generate a secure API key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. **Run migrations:**
```bash
npm run migrate
```

This will create the schema from `sql/schema.sql`.

5. **Seed demo data:**
```bash
npm run seed
```

This creates ~160 demo appointment slots across 7 days with 2 providers.

6. **Start the server:**
```bash
npm run dev
```

API will be available at `http://localhost:3000`

## API Endpoints

### Health Check
```http
GET /health
```
Returns 200 OK (no authentication required).

### List Slots
```http
GET /slots?provider={provider}
X-API-Key: your-api-key
```

Query parameters:
- `provider` (optional): Filter by provider name

Response:
```json
{
  "slots": [
    {
      "id": "slot_abc123",
      "start": "2026-12-10T09:00:00Z",
      "end": "2026-12-10T09:30:00Z",
      "provider": "Dr. Sarah Chen",
      "available": true
    }
  ]
}
```

### Create Booking
```http
POST /bookings
X-API-Key: your-api-key
Idempotency-Key: unique-uuid-here
Content-Type: application/json

{
  "slot_id": "slot_abc123",
  "name": "John Doe",
  "email": "john@example.com"
}
```

Responses:
- `201 Created` - Booking successful
- `409 Conflict` - Slot already booked
- `400 Bad Request` - Invalid input or slot already started
- `404 Not Found` - Slot doesn't exist
- `429 Too Many Requests` - Rate limit exceeded (5 attempts/60s per email)

### List Bookings
```http
GET /bookings?email=john@example.com&cursor={cursor}
X-API-Key: your-api-key
```

Query parameters:
- `email` (required): User's email address
- `cursor` (optional): Pagination cursor from previous response

Response:
```json
{
  "bookings": [
    {
      "id": "book_xyz789",
      "slot_id": "slot_abc123",
      "name": "John Doe",
      "email": "john@example.com",
      "status": "confirmed",
      "created_at": "2026-12-01T10:00:00Z"
    }
  ],
  "cursor": "next-page-cursor"
}
```

### Cancel Booking
```http
DELETE /bookings/{id}
X-API-Key: your-api-key
```

Responses:
- `200 OK` - Booking cancelled
- `404 Not Found` - Booking doesn't exist
- `409 Conflict` - Booking already cancelled

### Reset (Testing Only)
```http
POST /reset
X-API-Key: your-api-key
```

Truncates all tables. **Do not expose in production.**

## Database Schema

### Slots Table
```sql
CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL
);
```

### Bookings Table
```sql
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  seq BIGSERIAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent double-booking
CREATE UNIQUE INDEX idx_bookings_slot_confirmed 
ON bookings(slot_id) WHERE status = 'confirmed';
```

### Idempotency Keys Table
```sql
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response JSONB NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Booking Attempts Table (Rate Limiting)
```sql
CREATE TABLE booking_attempts (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_booking_attempts_email_time 
ON booking_attempts(email, attempted_at);
```

## Testing

Run all tests:
```bash
npm test
```

Tests are organized by commit/level:
- `tests/commit0.test.ts` - Health check
- `tests/commit1.test.ts` - Basic CRUD operations
- `tests/commit2.test.ts` - Authentication & validation
- `tests/commit3.test.ts` - Concurrency safety
- `tests/commit4.test.ts` - Idempotency & pagination
- `tests/commit5.test.ts` - Rate limiting

**Note:** Tests run sequentially (`--test-concurrency=1`) to avoid conflicts with the `/reset` endpoint.

## Rate Limiting Details

- **Limit:** 5 booking attempts per email per 60 seconds
- **Implementation:** PostgreSQL advisory locks + attempts tracking
- **Behavior:**
  - Failed bookings (4xx, 5xx) insert attempt record
  - Successful bookings (201) do NOT insert attempt record
  - 429 responses do NOT insert attempt record (waiting doesn't count as attempt)
- **Response:** `429 Too Many Requests` with `Retry-After` header

## Idempotency

POST /bookings supports idempotency keys to prevent duplicate bookings:

1. Client generates unique UUID: `crypto.randomUUID()`
2. Server checks if key exists
3. If exists and fingerprint matches → return cached response
4. If exists and fingerprint differs → 409 Conflict
5. If new → process booking and cache response

**Fingerprint:** Canonical JSON of `{slot_id, name, email}` (sorted keys)

## Development

**File Structure:**
```
src/
├── index.ts           # Entry point
├── app.ts             # Express app setup
├── config.ts          # Environment config
├── db.ts              # Database connection
├── ids.ts             # ID generation (nanoid)
├── time.ts            # Timestamp utilities
├── http/
│   ├── auth.ts        # API key middleware
│   └── email.ts       # Email validation
└── routes/
    ├── bookings.ts    # Booking endpoints
    ├── reset.ts       # Reset endpoint
    └── slots.ts       # Slot endpoints

sql/
└── schema.sql         # Database schema

scripts/
└── seed.ts            # Demo data seeding

tests/
└── commit*.test.ts    # Test suites
```

**Available Scripts:**
- `npm run dev` - Start development server with auto-reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled production build
- `npm test` - Run test suite
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed demo data

## Deployment

### Environment Variables

Required in production:
```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
API_KEY=production-api-key
CORS_ORIGIN=https://your-web-app.com
NODE_ENV=production
```

### Database Setup

1. Provision PostgreSQL database (e.g., Neon, RDS, DigitalOcean)
2. Run migrations: `npm run migrate`
3. Seed initial data: `npm run seed` (optional)

### Deploy API

Can be deployed to:
- **Render** (recommended for ease)
- **Railway**
- **Fly.io**
- **AWS Elastic Beanstalk**
- **Heroku**

### Production Checklist

- [ ] Remove `/reset` endpoint or restrict to non-production
- [ ] Use strong, randomly generated API key
- [ ] Configure CORS_ORIGIN to match web client domain
- [ ] Enable SSL/TLS for database connection
- [ ] Set up database backups
- [ ] Configure connection pool limits
- [ ] Monitor rate limit attempts
- [ ] Set up logging and error tracking

## Architecture Decisions

**Why partial unique index?**
- Allows multiple cancelled bookings for same slot
- Only enforces uniqueness for `status='confirmed'`

**Why advisory locks for rate limiting?**
- Prevents race conditions between concurrent requests
- Lock released automatically at transaction end
- No cleanup needed

**Why cursor pagination?**
- More efficient than OFFSET for large datasets
- Consistent results even as data changes
- Uses BIGSERIAL `seq` column

**Why soft deletes?**
- Maintains referential integrity
- Allows audit trail
- Can be reversed if needed

**Why claim-and-poll for idempotency?**
- Prevents duplicate processing
- Returns same response for retries
- Detects different payloads with same key

## License

MIT

## Author

Built for Koya interview assessment
