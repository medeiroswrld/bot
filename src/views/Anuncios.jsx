import React, { useEffect, useState } from 'react';
import { Megaphone, CheckCircle2, Clock, AlertCircle, Hourglass, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { brl } from '../lib/financeiro.js';

// Painel de anúncios.
//
// Duas perguntas, e só duas: qual anúncio traz COMPRADOR (não conversa), e o
// sinal está mesmo voltando pra Meta?
//
// A segunda existe por causa do episódio das notificações: passei rodadas
// adivinhando por que nada chegava, quando um contador na tela teria dado a
// resposta na primeira. Fila que ninguém enxerga é fila que falha em silêncio.

// Nomes escolhidos pelo que o Gerenciador de Eventos reconhece, não pelo que a
// documentação lista: `QualifiedLead` aparece nos docs mas não existe na
// interface, e evento com nome desconhecido entra sem servir pra otimização.
const ROTULO_EVENTO = {
    LeadSubmitted:    'Qualificado',
    InitiateCheckout: 'Visita agendada',
    Purchase:         'Venda',
};

const ROTULO_STATUS = {
    enviado:  { texto: 'Enviados',  cor: '#059669', bg: '#ecfdf5', Icone: CheckCircle2 },
    pendente: { texto: 'Na fila',   cor: '#b45309', bg: '#fef3c7', Icone: Clock },
    expirado: { texto: 'Expirados', cor: '#64748b', bg: '#f1f5f9', Icone: Hourglass },
    erro:     { texto: 'Com erro',  cor: '#dc2626', bg: '#fef2f2', Icone: AlertCircle },
};

const Cartao = ({ status, quantidade }) => {
    const info = ROTULO_STATUS[status];
    if (!info) return null;
    const { Icone } = info;
    return (
        <div style={{
            flex: '1 1 140px', background: info.bg, borderRadius: 14,
            padding: '0.9rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
            <Icone size={20} color={info.cor} />
            <div>
                <p style={{ fontSize: '1.35rem', fontWeight: 700, color: info.cor, lineHeight: 1.1 }}>{quantidade}</p>
                <p style={{ fontSize: '0.75rem', color: info.cor, opacity: 0.85 }}>{info.texto}</p>
            </div>
        </div>
    );
};

export default function Anuncios() {
    const [carregando, setCarregando] = useState(true);
    const [anuncios, setAnuncios]     = useState([]);
    const [fila, setFila]             = useState({});
    const [erros, setErros]           = useState([]);
    const [erroTela, setErroTela]     = useState('');

    useEffect(() => {
        let vivo = true;

        (async () => {
            const [desempenho, eventos] = await Promise.all([
                supabase.from('anuncio_desempenho').select('*').order('vendas', { ascending: false }),
                supabase.from('capi_events').select('status, event_name, ultimo_erro, created_at'),
            ]);

            if (!vivo) return;

            // Tabela ausente = migration não rodou. Dizer isso é melhor do que
            // mostrar a tela vazia, que parece "ainda não chegou ninguém".
            if (desempenho.error || eventos.error) {
                setErroTela(desempenho.error?.message || eventos.error?.message || '');
                setCarregando(false);
                return;
            }

            setAnuncios(desempenho.data ?? []);

            const contagem = {};
            for (const e of eventos.data ?? []) {
                contagem[e.status] = (contagem[e.status] ?? 0) + 1;
            }
            setFila(contagem);

            setErros(
                (eventos.data ?? [])
                    .filter(e => e.status === 'erro' && e.ultimo_erro)
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                    .slice(0, 5),
            );
            setCarregando(false);
        })();

        return () => { vivo = false; };
    }, []);

    if (carregando) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
                <Loader2 size={28} style={{ color: '#818cf8', animation: 'spin 1s linear infinite' }} />
            </div>
        );
    }

    if (erroTela) {
        return (
            <div className="card" style={{ padding: '1.5rem' }}>
                <h2 style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Anúncios</h2>
                <p style={{ color: '#dc2626', fontSize: '0.9rem' }}>
                    Não consegui ler os dados de anúncio: {erroTela}
                </p>
            </div>
        );
    }

    const semNada = anuncios.length === 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
                <h2 style={{ fontWeight: 700, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Megaphone size={20} /> Anúncios
                </h2>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    Quem chegou pelo anúncio, e o que aconteceu com essa pessoa depois.
                </p>
            </div>

            {/* Estado do sinal que volta pra Meta */}
            <div className="card" style={{ padding: '1.1rem 1.25rem' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.85rem' }}>
                    Conversões devolvidas para a Meta
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {['enviado', 'pendente', 'expirado', 'erro'].map(s => (
                        <Cartao key={s} status={s} quantidade={fila[s] ?? 0} />
                    ))}
                </div>

                {(fila.expirado ?? 0) > 0 && (
                    <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.85rem', lineHeight: 1.5 }}>
                        Expirado quer dizer que a venda aconteceu mais de 7 dias depois do clique.
                        A Meta descarta esses — é o limite dela, não uma falha nossa. Continua valendo
                        como informação de origem aqui dentro.
                    </p>
                )}

                {erros.length > 0 && (
                    <div style={{ marginTop: '0.9rem', padding: '0.75rem 0.9rem', background: '#fef2f2', borderRadius: 10 }}>
                        <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#dc2626', marginBottom: '0.4rem' }}>
                            Últimos erros
                        </p>
                        {erros.map((e, i) => (
                            <p key={i} style={{ fontSize: '0.72rem', color: '#991b1b', fontFamily: 'monospace', wordBreak: 'break-word', marginBottom: '0.2rem' }}>
                                {ROTULO_EVENTO[e.event_name] ?? e.event_name}: {e.ultimo_erro}
                            </p>
                        ))}
                    </div>
                )}
            </div>

            {/* Desempenho por anúncio */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {semNada ? (
                    <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center' }}>
                        <Megaphone size={32} color="#cbd5e1" style={{ marginBottom: '0.75rem' }} />
                        <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Nenhum clique em anúncio ainda</p>
                        <p className="text-muted" style={{ fontSize: '0.85rem', lineHeight: 1.5, maxWidth: 420, margin: '0 auto' }}>
                            Assim que alguém entrar no WhatsApp tocando num anúncio, ele aparece aqui —
                            com o criativo, quantos viraram proposta e quantos compraram.
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--input-bg)' }}>
                                    {['Anúncio', 'Leads', 'Qualificados', 'Vendas', 'Faturamento'].map((h, i) => (
                                        <th key={h} style={{
                                            padding: '0.75rem 1rem', textAlign: i === 0 ? 'left' : 'right',
                                            fontWeight: 600, color: '#64748b', fontSize: '0.75rem',
                                            textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap',
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {anuncios.map(a => {
                                    // A Meta manda referral tanto de anúncio pago quanto de
                                    // publicação orgânica, mas só o pago tem identificador de
                                    // clique. Sem essa distinção na tela, o lojista compara os
                                    // dois como se fossem campanhas e decide investimento errado.
                                    const organico = a.source_type === 'post';
                                    return (
                                    <tr key={a.source_id} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '0.75rem 1rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                                <p style={{ fontWeight: 600 }}>{a.headline || 'Sem título'}</p>
                                                <span style={{
                                                    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em',
                                                    textTransform: 'uppercase', padding: '0.1rem 0.4rem', borderRadius: 4,
                                                    background: organico ? '#f1f5f9' : '#eef2ff',
                                                    color: organico ? '#64748b' : '#4338ca',
                                                }}>
                                                    {organico ? 'publicação' : 'anúncio'}
                                                </span>
                                            </div>
                                            <p className="text-muted" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{a.source_id}</p>
                                            {organico && (
                                                <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '0.2rem' }}>
                                                    Alcance orgânico — chegou sem clique pago, a Meta não credita
                                                </p>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{a.leads}</td>
                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{a.qualificados}</td>
                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: a.vendas > 0 ? '#059669' : 'inherit' }}>{a.vendas}</td>
                                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>
                                            {a.faturamento > 0 ? brl(a.faturamento) : '—'}
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <p className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>
                <strong>Anúncio</strong> é a entrega paga: carrega o identificador do clique, e só ela
                vira conversão devolvida pra Meta. <strong>Publicação</strong> é quem chegou pelo post
                sem passar pelo clique pago — compartilhamento, feed da página, ou visita ao perfil.
                Duas linhas com o mesmo título costumam ser o mesmo criativo chegando por esses dois
                caminhos.
            </p>
            <p className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>
                Isso significa que <strong>parte do resultado do seu anúncio é invisível pra Meta</strong>,
                mas aparece aqui. Ao comparar o custo por lead do gerenciador com o que você vê nesta
                tela, some as duas linhas do mesmo criativo — senão o anúncio parece pior do que é.
            </p>
            <p className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>
                O custo do anúncio não aparece aqui ainda — ele vive no gerenciador da Meta.
                Enquanto isso, a coluna que importa é <strong>Vendas</strong>: é ela que diz qual
                criativo traz comprador, e é exatamente esse sinal que está sendo devolvido pra Meta.
            </p>
        </div>
    );
}
