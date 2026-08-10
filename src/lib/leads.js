// Classificação de cliente por TEMPO DE CADASTRO.
//
// Atenção ao nome: isto NÃO é o `status` do funil, que também tem uma etapa
// chamada "Novo". Aqui é a idade do contato — um cliente pode estar em
// "Negociação" no funil e ser "Antigo" nesta régua. São eixos diferentes.
//
// Existe uma cópia do corte em supabase/functions/send-campaign (o servidor
// precisa conferir por conta própria, não confiar no que o front mandar).
export const DIAS_CLIENTE_NOVO = 30;

/** 'novo' se cadastrado nos últimos 30 dias, senão 'antigo'. */
export function classificarIdade(lead) {
  const bruto = lead?.date ?? lead?.created_at;
  if (!bruto) return 'antigo';
  const t = new Date(bruto).getTime();
  if (Number.isNaN(t)) return 'antigo';
  return Date.now() - t <= DIAS_CLIENTE_NOVO * 86400000 ? 'novo' : 'antigo';
}

export const IDADE_ROTULO = {
  novo:   { label: `Novo (até ${DIAS_CLIENTE_NOVO}d)`, bg: '#ecfdf5', cor: '#059669' },
  antigo: { label: 'Antigo',                            bg: '#f1f5f9', cor: '#475569' },
};
