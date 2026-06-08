ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS specs_image_url TEXT,
  ADD COLUMN IF NOT EXISTS video_url TEXT;

COMMENT ON COLUMN cars.specs_image_url IS 'URL da foto de especificações enviada pelo bot ao cliente';
COMMENT ON COLUMN cars.video_url IS 'URL do vídeo do veículo enviado pelo bot ao cliente (MP4 H.264, max 16MB)';
