-- 005_max_appointments_per_slot.sql
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS max_appointments_per_slot integer NOT NULL DEFAULT 1;
