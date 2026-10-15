-- PostgreSQL starting schema for the next implementation phase.
-- Apply only after review; current local demo persists non-clinical sample data in data/db.json.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor','patient','pharmacy','reception')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES app_users(id),
  display_name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  session_fee_egp NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (session_fee_egp >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS doctor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  slot_minutes SMALLINT NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 10 AND 240),
  session_type TEXT NOT NULL DEFAULT 'online' CHECK (session_type IN ('online','in_person','both')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (ends_at > starts_at),
  UNIQUE (doctor_id, weekday, starts_at, session_type)
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES app_users(id),
  patient_number TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patient_profiles(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  service_code TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'online' CHECK (session_type IN ('online','in_person')),
  amount_egp NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_egp >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','paid_test','failed_test')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pending_payment','confirmed','cancelled','completed','confirmed_test')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_appointment_per_doctor_slot
  ON appointments (doctor_id, starts_at) WHERE status IN ('pending','pending_payment','confirmed','confirmed_test');
CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id),
  patient_id UUID NOT NULL REFERENCES patient_profiles(id),
  provider TEXT NOT NULL,
  provider_reference TEXT UNIQUE,
  amount_egp NUMERIC(10,2) NOT NULL CHECK (amount_egp >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'EGP',
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded','paid_test','failed_test')),
  is_test BOOLEAN NOT NULL DEFAULT TRUE,
  provider_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payment_transactions_patient_created
  ON payment_transactions (patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pharmacy_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  stock_quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit TEXT NOT NULL DEFAULT 'unit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES app_users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Production phase must add migrations, access policies, encrypted transport, backups,
-- retention rules, consent records, and a reviewed authorization matrix before real patient data.
