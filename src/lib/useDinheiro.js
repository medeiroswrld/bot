// A moeda da loja logada, já ligada aos formatadores.
//
// Existe para a view não ter que repetir
// `dinheiro(v, companySettings?.moeda, companySettings?.locale)` em cada linha
// — repetição que é exatamente como um dos pontos acabaria ficando de fora.
//
// Separado de `dinheiro.js` de propósito: aquele é puro e é importado por
// `financeiro.js` e `estoqueTexto.js`, que não devem puxar React.

import { useMemo } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { dinheiro, numero, simboloDe } from './dinheiro.js';

export function useDinheiro() {
  const { companySettings } = useAppContext();
  const moeda  = companySettings?.moeda  ?? 'BRL';
  const locale = companySettings?.locale ?? 'pt-BR';

  return useMemo(() => ({
    moeda,
    locale,
    /** Símbolo sozinho, para rótulo de formulário. */
    simbolo: simboloDe(moeda, locale),
    /** `opcoes` = { min, max } de casas decimais. Ver `dinheiro.js`. */
    dinheiro: (v, opcoes) => dinheiro(v, moeda, locale, opcoes),
    numero: (v) => numero(v, locale),
  }), [moeda, locale]);
}
