-- 043 — Libera áudio no bucket chat-media
--
-- O bucket nasceu só para foto do cliente (042 é outra coisa; ver 041), com
-- allowed_mime_types travado em imagem. Com a coexistência ativa, o lojista
-- responde pelo celular mandando foto E áudio, e o eco desses áudios não tinha
-- onde ser guardado — o upload era recusado pelo próprio bucket.
--
-- Nota de áudio do WhatsApp chega como 'audio/ogg; codecs=opus'. O Storage
-- compara só o mime base, mas os outros formatos entram porque o app do
-- celular varia conforme o aparelho.
update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp',
         'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr'
       ],
       file_size_limit = 20971520   -- 20MB: áudio longo passa dos 10MB de antes
 where id = 'chat-media';
