import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { MODELO_PADRAO } from './contrato.js';
import { MODELO_COMPLETO } from './contratoCompleto.js';

// Modelos de contrato disponíveis para a loja, num lugar só.
//
// Existe como hook compartilhado porque DUAS telas geram contrato — o estoque,
// logo depois da venda, e os vendidos, na reimpressão. Se cada uma carregasse e
// escolhesse por conta própria, elas divergiriam com o tempo. Foi assim que o
// `social-webhook` nasceu como cópia do `whatsapp-webhook` neste projeto e
// passou meses sem as travas que o outro já tinha.
//
// ── Os modelos embutidos ────────────────────────────────────────────────────
//
// A loja pode ter modelos próprios no banco (`contract_templates`), mas os dois
// embutidos aparecem mesmo para quem nunca configurou nada. Isso é de propósito:
// o seletor precisa ter conteúdo no primeiro dia, e não depois de alguém passar
// por Configurações. Modelo do banco com o mesmo nome substitui o embutido —
// quem personalizou não vê a versão de fábrica competindo com a dele.

const EMBUTIDOS = [
  { id: 'embutido:padrao',   nome: 'Compra e venda',            html: MODELO_PADRAO,   embutido: true },
  { id: 'embutido:completo', nome: 'Completo (com testemunhas)', html: MODELO_COMPLETO, embutido: true },
];

export function useModelosContrato() {
  const [modelos, setModelos] = useState(EMBUTIDOS);
  const [escolhido, setEscolhido] = useState(EMBUTIDOS[0].id);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('id, nome, html, padrao')
        .order('padrao', { ascending: false })
        .order('created_at');

      if (!vivo) return;

      // Erro aqui NÃO pode deixar a loja sem contrato: a tabela pode ainda não
      // existir no banco de alguém, ou a rede pode falhar. Nesse caso ficam os
      // embutidos, que imprimem igual.
      const doBanco = error ? [] : (data ?? []);
      const nomesDoBanco = new Set(doBanco.map((m) => m.nome));
      const lista = [
        ...doBanco,
        ...EMBUTIDOS.filter((e) => !nomesDoBanco.has(e.nome)),
      ];

      setModelos(lista);
      setEscolhido(doBanco.find((m) => m.padrao)?.id ?? lista[0]?.id);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, []);

  const atual = modelos.find((m) => m.id === escolhido) ?? modelos[0];
  return { modelos, escolhido, setEscolhido, htmlDoModelo: atual?.html ?? MODELO_PADRAO, carregando };
}

/** O seletor em si, para as duas telas mostrarem a mesma coisa. */
export function SeletorModelo({ modelos, escolhido, onEscolher }) {
  if (!modelos || modelos.length < 2) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>Modelo:</label>
      <select
        value={escolhido}
        onChange={(e) => onEscolher(e.target.value)}
        style={{
          padding: '5px 10px', borderRadius: 8, fontSize: '0.84rem',
          background: 'var(--card-bg)', color: 'var(--color-text)',
          border: '1px solid var(--border-color)',
        }}>
        {modelos.map((m) => (
          <option key={m.id} value={m.id}>{m.nome}</option>
        ))}
      </select>
    </div>
  );
}
