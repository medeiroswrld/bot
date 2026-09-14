// Verificação em duas etapas (TOTP) — a camada fina sobre o supabase.auth.mfa.
//
// O servidor já aceita TOTP desde sempre (mfa_totp_enroll_enabled). O que não
// existia era interface, então ninguém nunca cadastrou um fator. Este arquivo
// concentra as chamadas pra que a tela não precise saber a coreografia do
// Supabase, que tem duas pegadinhas:
//
//   1. Cadastrar um fator NÃO o ativa. Ele nasce 'unverified' e só vira
//      'verified' depois que o usuário digita o primeiro código. Fator pendente
//      fica pra trás e ocupa o apelido — tentar cadastrar de novo com o mesmo
//      nome dá erro. Por isso `criarFator` limpa os pendentes antes.
//
//   2. Validar código é SEMPRE dois passos: challenge() cria o desafio,
//      verify() confere. Um sozinho não faz nada.
import { supabase } from './supabase.js';

const APELIDO = 'App autenticador';

/** Só dígitos: o usuário cola "123 456" ou com traço, e o Supabase recusa. */
const limpar = (codigo) => String(codigo ?? '').replace(/\D/g, '');

/**
 * O login precisa pedir código agora?
 *
 * `nextLevel` é o nível que a conta EXIGE; `currentLevel` é o que a sessão tem.
 * Quem não cadastrou fator tem nextLevel 'aal1' e passa direto.
 *
 * Em caso de erro devolve false de propósito: uma falha de rede aqui não pode
 * trancar o lojista do lado de fora do próprio sistema.
 */
export const precisaDesafio = async () => {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
};

/** Fatores separados por estado. */
export const listarFatores = async () => {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const todos = data?.all ?? [];
  return {
    ativos:    todos.filter((f) => f.status === 'verified'),
    pendentes: todos.filter((f) => f.status !== 'verified'),
  };
};

/** Apaga cadastros que ficaram no meio do caminho. */
const limparPendentes = async () => {
  const { pendentes } = await listarFatores();
  for (const f of pendentes) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
};

/** Gera um fator novo. Devolve o QR (SVG) e o segredo pra digitação manual. */
export const criarFator = async () => {
  await limparPendentes();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: APELIDO,
  });
  if (error) throw error;
  return {
    id: data.id,
    qr: data.totp?.qr_code ?? '',
    // Pra quem não consegue ler o QR (câmera ruim, celular de outra pessoa).
    segredo: data.totp?.secret ?? '',
  };
};

/** Confirma o primeiro código e ATIVA o fator. */
export const confirmarFator = async (factorId, codigo) => {
  const { data: desafio, error: erroDesafio } =
    await supabase.auth.mfa.challenge({ factorId });
  if (erroDesafio) throw erroDesafio;

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: desafio.id,
    code: limpar(codigo),
  });
  if (error) throw error;
};

/** Valida o código no login. Sobe a sessão de aal1 pra aal2. */
export const responderDesafio = async (codigo) => {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const fator = (data?.totp ?? [])[0];
  if (!fator) throw new Error('Nenhum aplicativo autenticador cadastrado nesta conta.');
  await confirmarFator(fator.id, codigo);
};

/**
 * Desliga a verificação em duas etapas.
 *
 * Exige sessão aal2 — ou seja, só desliga quem acabou de provar que tem o
 * aplicativo. Quem perdeu o celular NÃO consegue desligar sozinho, e é por isso
 * que existe a remoção pelo painel do administrador.
 */
export const removerFator = async (factorId) => {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
};
