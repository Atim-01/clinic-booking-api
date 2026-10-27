-- Slots table
CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slots_start_ts ON slots(start_ts);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGSERIAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_email_seq ON bookings(email, seq);

-- Partial unique index: only one confirmed booking per slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_slot_confirmed 
  ON bookings(slot_id) WHERE status = 'confirmed';
