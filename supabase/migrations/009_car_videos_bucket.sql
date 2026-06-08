-- Bucket público para vídeos de veículos (rodar no SQL Editor do Supabase).
-- 20 MB de limite (Meta aceita 16 MB; folga para validação no frontend).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('car-videos', 'car-videos', true, 20971520, array['video/mp4'])
on conflict (id) do update
  set public = true,
      file_size_limit = 20971520,
      allowed_mime_types = array['video/mp4'];

-- Policies de RLS (idempotentes)
drop policy if exists "Public read car videos"        on storage.objects;
drop policy if exists "Auth users upload car videos"  on storage.objects;
drop policy if exists "Auth users update car videos"  on storage.objects;
drop policy if exists "Auth users delete car videos"  on storage.objects;

-- SELECT (leitura pública)
create policy "Public read car videos" on storage.objects
  for select using (bucket_id = 'car-videos');

-- INSERT (apenas autenticados)
create policy "Auth users upload car videos" on storage.objects
  for insert with check (
    bucket_id = 'car-videos'
    and auth.role() = 'authenticated'
  );

-- UPDATE (apenas autenticados)
create policy "Auth users update car videos" on storage.objects
  for update using (
    bucket_id = 'car-videos'
    and auth.role() = 'authenticated'
  );

-- DELETE (apenas autenticados)
create policy "Auth users delete car videos" on storage.objects
  for delete using (
    bucket_id = 'car-videos'
    and auth.role() = 'authenticated'
  );
