-- 116 — fuso horário e moeda por loja
--
-- ── O defeito que isto fecha ──────────────────────────────────────────────
--
-- `America/Sao_Paulo` estava fixo em seis arquivos, e todos tomam DECISÃO com
-- ele: se o bot responde agora, quando o follow-up sai, a que horas vai o
-- lembrete de visita, em que dia cai o aniversário.
--
-- Portugal é UTC+0/+1 e o Brasil é UTC−3. Um stand em Lisboa que atende das
-- 9h às 19h teria o bot ligando às 5h da manhã e desligando às 15h — mudo
-- durante metade do expediente e falando de madrugada.
--
-- E falharia EM SILÊNCIO, que é o modo de falha mais caro deste produto: o
-- lojista não vê erro nenhum, só clientes sem resposta.
--
-- ── Por que coluna explícita, e não derivada do `locale` ──────────────────
--
-- `locale` não determina fuso. A Espanha tem dois (península e Canárias) e
-- Portugal também (continente e Açores). Derivar acertaria na maioria e
-- erraria exatamente nos casos em que ninguém iria conferir.
--
-- ── Por que o Brasil não muda ─────────────────────────────────────────────
--
-- Os defaults são os valores de hoje. Toda loja existente continua em
-- `America/Sao_Paulo` e `BRL` sem ninguém tocar em nada — a mudança só
-- aparece para quem escolher outro país.

alter table public.company_settings
  add column if not exists timezone text not null default 'America/Sao_Paulo',
  add column if not exists moeda    text not null default 'BRL';

comment on column public.company_settings.timezone is
  'Fuso da loja, no formato IANA (America/Sao_Paulo, Europe/Lisbon, Europe/Madrid). Decide horario de atendimento, follow-up, lembrete de visita e aniversario. NAO e derivado do locale: Espanha e Portugal tem mais de um fuso.';

comment on column public.company_settings.moeda is
  'Codigo ISO da moeda em que a loja opera (BRL, EUR, USD). Formata preco no CRM e no que o bot manda ao cliente.';

-- Quem escolheu outro pais mas ficou com o fuso do Brasil provavelmente nao
-- percebeu. Alinha o que da para alinhar com seguranca; onde o pais tem mais
-- de um fuso, fica o mais populoso e o lojista ajusta.
update public.company_settings
   set timezone = case locale
                    when 'pt-PT' then 'Europe/Lisbon'
                    when 'es-ES' then 'Europe/Madrid'
                    else timezone
                  end,
       moeda    = case locale
                    when 'pt-PT' then 'EUR'
                    when 'es-ES' then 'EUR'
                    else moeda
                  end
 where locale in ('pt-PT', 'es-ES')
   and timezone = 'America/Sao_Paulo';
