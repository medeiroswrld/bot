// Quem da equipe está atendendo esta conversa?
//
// A loja replica o mesmo WhatsApp em três celulares. Toda resposta chega como
// eco, vinda do MESMO número — o sistema não tem como saber qual das três
// pessoas digitou.
//
// Pedir pra marcar à mão não resolve: quem responde está no celular, não no
// CRM, e tag que depende de lembrar morre na primeira sexta cheia.
//
// Mas eles já se identificam sozinhos. Numa conversa real da DSC:
//   "Boa noite meu amigo tudo bem me chamo rodrigo faço parte da equipe..."
//
// Então em vez de criar hábito novo, lemos o que já é hábito.

/** Sem acento, minúsculo, pontuação virando espaço. */
function cru(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:@-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Acha na mensagem o nome de alguém da equipe — mas SÓ em construções de
 * auto-identificação.
 *
 * Casar qualquer nome solto no texto seria pior que não casar nada: um
 * "vou passar pro João" marcaria o João, que não falou com ninguém. Por isso
 * cada padrão exige que a pessoa esteja falando DE SI.
 *
 * @param texto  a mensagem que o vendedor enviou
 * @param equipe nomes cadastrados em Configurações → Equipe
 */
export function detectarAtendente(texto: string, equipe: string[]): string | null {
  const t = cru(texto);
  if (!t) return null;

  // Só o primeiro nome interessa: a pessoa escreve "me chamo rodrigo", não
  // "me chamo Rodrigo Silva Santos".
  const nomes = (equipe ?? [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean)
    .map((n) => ({ exibicao: n, chave: cru(n).split(' ')[0] }))
    .filter((n) => n.chave.length >= 2);

  if (!nomes.length) return null;

  for (const { exibicao, chave } of nomes) {
    const n = chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const padroes = [
      `me chamo ${n}\\b`,
      `meu nome (e|eh) ${n}\\b`,
      `aqui (e|eh|quem fala e) (o |a )?${n}\\b`,
      `\\b(e|eh) (o |a )?${n} (falando|aqui)\\b`,
      `\\bsou (o |a )?${n}\\b`,
      `^${n}\\s*[:,-]`,          // "Rodrigo: bom dia"
      `[-—]\\s*${n}\\s*$`,       // "... — Rodrigo"
      `\\b(att|abs|abraco|abracos)\\s*[,.]?\\s*${n}\\s*$`,
    ];

    if (padroes.some((p) => new RegExp(p, 'i').test(t))) return exibicao;
  }

  // Inicial no começo — "R: bom dia". Só quando UMA pessoa da equipe começa
  // com aquela letra; com dois "R" na loja, chutar seria pior que não marcar.
  const inicial = t.match(/^([a-z])\s*[:.-]\s+/);
  if (inicial) {
    const letra = inicial[1];
    const candidatos = nomes.filter((n) => n.chave.startsWith(letra));
    if (candidatos.length === 1) return candidatos[0].exibicao;
  }

  return null;
}

/** Iniciais pro círculo da lista: "Rodrigo Silva" → "RS", "Rodrigo" → "R". */
export function iniciaisDe(nome: string): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
  return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
}
