-- 041 — Bucket para mídia recebida do cliente no WhatsApp
--
-- Hoje foto que o cliente manda é DESCARTADA: o parser só aceita texto, áudio
-- e botão, então a mensagem não existe, não aparece no CRM e o bot não responde
-- nada. Quem manda foto costuma estar no momento mais quente da conversa
-- (fotografando o carro da troca, ou perguntando "vocês têm esse?").
--
-- Precisa de bucket próprio porque a URL que a Meta devolve EXPIRA em minutos:
-- sem copiar, o lojista abre a conversa depois e não vê a imagem. E o Claude
-- precisa de uma URL estável pra ler a foto.
--
-- Público na leitura como o car-images: a URL é longa e não indexada, e é o que
-- permite o CRM e a API do Claude carregarem a imagem sem token.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', true, 10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Public read chat media"   on storage.objects;
drop policy if exists "Service writes chat media" on storage.objects;

-- Leitura pública (CRM e Claude carregam a imagem direto).
create policy "Public read chat media" on storage.objects
  for select using (bucket_id = 'chat-media');

-- Escrita só pela service role: quem grava é o webhook, nunca o navegador.
-- (Sem policy de INSERT para authenticated/anon, o cliente não consegue subir
-- nada aqui — diferente do car-images, onde o lojista sobe fotos pelo painel.)
create policy "Service writes chat media" on storage.objects
  for insert with check (
    bucket_id = 'chat-media'
    and auth.role() = 'service_role'
  );
