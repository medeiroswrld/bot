-- 096 — o menu de veículos não se repete na mesma conversa
--
-- Caso real de 21/09, e o bot ficou grosso sem querer:
--
--   bot:     "Abre o menu ali que já aparecem as opções."
--   cliente: "Não dá pra ver todos para no new fiesta"
--   bot:     "Os carros nessa faixa já estão no menu ali em cima, pode tocar."
--   cliente: "Ate 24.000"
--   bot:     "Os opções até R$ 24.000 estão ali no menu, pode dar uma olhada."
--
-- O cliente disse que NÃO estava conseguindo ver, e o bot mandou ele olhar o
-- menu — duas vezes. Quem lê isso entende "vira-se".
--
-- A causa foi minha: a instrução ao modelo proibia repetir a lista em texto,
-- sem exceção. Quando o cliente pediu ajuda, o bot não tinha permissão de
-- ajudar. Uma regra sem saída de emergência vira exatamente isso.
--
-- Esta coluna é a metade determinística do conserto. A outra metade é a
-- instrução, que passa a mandar ESCREVER a lista quando o cliente diz que não
-- está vendo. Mas instrução depende do julgamento do modelo; a marca de tempo
-- não depende de ninguém: mandou menu há pouco, não manda outro, e a resposta
-- seguinte sai em texto.
alter table public.conversations
  add column if not exists menu_enviado_em timestamptz;

comment on column public.conversations.menu_enviado_em is
  'Quando o ultimo menu interativo de veiculos foi enviado. Dentro da janela curta, o bot NAO manda outro e responde em texto — cliente que pede de novo esta com dificuldade, e insistir no menu e o que soou grosso em 21/09.';
