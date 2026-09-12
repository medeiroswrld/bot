// Números digitados por gente, não por máquina.
//
// O lojista escreve quilometragem como se escreve em português: 14.699. Para o
// JavaScript esse ponto é DECIMAL, então `Number("14.699")` é 14,699 — e as
// colunas `cars.mileage` e `cars.trade_in_km` são `integer`. O Postgres recusa:
//
//     invalid input syntax for type integer: "14.699"
//
// O update inteiro morre junto, então a venda (ou o cadastro do veículo) falha
// por causa de um ponto. Foi o que travou a venda do dia 11/09/2026 — e é o
// mesmo defeito por trás do "cadastro não salva o KM" relatado antes.
//
// Quilometragem não tem casa decimal. Meio quilômetro não existe pra quem vende
// carro. Por isso a regra aqui é a mais simples que resolve: só os dígitos
// importam, qualquer pontuação é separador de milhar.
//
//     "14.699"  → 14699
//     "14.700"  → 14700
//     "14699"   → 14699
//     "14.699 km" → 14699
//     ""        → null   (campo vazio não é zero: zero é uma afirmação)
//
// Dinheiro NÃO passa por aqui, de propósito. Lá o ponto decimal é legítimo
// (1500.50 é um preço de verdade), então aplicar esta regra criaria um bug onde
// hoje não existe nenhum.
export const kmInteiro = (v) => {
  if (v === '' || v == null) return null;
  const digitos = String(v).replace(/\D/g, '');
  return digitos ? Number(digitos) : null;
};
