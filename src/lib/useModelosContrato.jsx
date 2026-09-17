import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { MODELO_PADRAO } from './contrato.js';

// Modelos de contrato disponíveis na hora de imprimir.
//
// ── O desenho ───────────────────────────────────────────────────────────────
//
//   contrato principal  → `company_settings.contract_template`, onde sempre
//                         esteve. A loja já tem o contrato dela colado ali.
//   modelos adicionais  → tabela `contract_templates`, cada um com nome próprio
//                         ("Repasse", "Consignação", o que a loja quiser).
//
// A lista NÃO absorveu o contrato principal de propósito. Mover o texto que o
// lojista já conhece para outro lugar resolveria um problema nosso, não dele —
// e o que ele pediu foi um campo a mais, não uma mudança no que funciona.
//
// ── Por que um hook compartilhado ───────────────────────────────────────────
//
// DUAS telas imprimem contrato: o estoque, logo depois da venda, e os vendidos,
// na reimpressão. Se cada uma carregasse por conta própria, elas divergiriam
// com o tempo — foi assim que o `social-webhook` nasceu como cópia do
// `whatsapp-webhook` neste projeto e passou meses sem as travas do outro.

const ID_PRINCIPAL = 'principal';

export function useModelosContrato(contratoPrincipal) {
  const [adicionais, setAdicionais] = useState([]);
  const [escolhido, setEscolhido] = useState(ID_PRINCIPAL);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('id, nome, html')
        .order('created_at');
      if (!vivo) return;
      // Falha aqui não pode deixar a loja sem contrato: sobra o principal, que
      // é o que ela usava antes de existir qualquer lista.
      setAdicionais(error ? [] : (data ?? []));
    })();
    return () => { vivo = false; };
  }, []);

  const modelos = [
    { id: ID_PRINCIPAL, nome: 'Contrato de venda', html: contratoPrincipal || MODELO_PADRAO },
    ...adicionais,
  ];

  const atual = modelos.find((m) => m.id === escolhido) ?? modelos[0];
  return { modelos, escolhido, setEscolhido, htmlDoModelo: atual?.html ?? MODELO_PADRAO };
}

/** O seletor, para as duas telas mostrarem a mesma coisa.
 *  Some quando só existe o principal: escolher entre uma opção é ruído. */
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
