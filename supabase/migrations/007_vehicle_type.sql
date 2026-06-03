-- 007_vehicle_type.sql
ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS vehicle_type text NOT NULL DEFAULT 'carro';
