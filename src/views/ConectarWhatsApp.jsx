import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

const APP_ID    = '871165479168665';
const CONFIG_ID = '849531434793375';

// Embedded Signup: conecta o WhatsApp da loja em um passo, sem o lojista
// precisar copiar Phone Number ID, WABA e token na mão.
const ConectarWhatsApp = () => {
    const { companySettings, refreshCompanySettings } = useAppContext();
    const [estado, setEstado] = useState('ocioso');  // ocioso | conectando | ok | erro
    const [erro, setErro]     = useState('');
    const [etapas, setEtapas] = useState([]);
    const [sdkPronto, setSdkPronto] = useState(false);

    // O `code` vem do callback do FB.login; o waba_id e o phone_number_id vêm
    // do evento de message. São DOIS caminhos assíncronos independentes, e a
    // ordem entre eles não é garantida — por isso guardamos as peças conforme
    // chegam e só disparamos quando as três estiverem na mão. Enviar direto de
    // dentro do callback funcionaria às vezes e falharia quando o evento
    // chegasse depois.
    const pecas   = useRef({ code: null, waba_id: null, phone_number_id: null });
    const enviado = useRef(false);

    const jaConectado = Boolean(companySettings?.whatsapp_phone_number_id);

    // ── SDK do Facebook, carregado só quando esta tela abre ──────────────────
    useEffect(() => {
        if (window.FB) { setSdkPronto(true); return; }
        window.fbAsyncInit = () => {
            window.FB.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: 'v25.0' });
            setSdkPronto(true);
        };
        const s = document.createElement('script');
        s.src = 'https://connect.facebook.net/en_US/sdk.js';
        s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
        document.body.appendChild(s);
    }, []);

    // Envia assim que as três peças existirem. O code vive 30s: nada de
    // confirmação, modal ou espera entre receber e mandar.
    const enviarQuandoCompleto = useCallback(async () => {
        const { code, waba_id, phone_number_id } = pecas.current;
        if (!code || !waba_id || !phone_number_id) return;
        if (enviado.current) return;          // trava contra POST duplicado
        enviado.current = true;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conectar-whatsapp`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${session?.access_token ?? ''}`,
                    },
                    body: JSON.stringify({ code, waba_id, phone_number_id }),
                },
            );
            const j = await res.json();
            setEtapas(j.etapas ?? []);
            if (!res.ok || !j.success) {
                setErro(j.error || 'Não consegui concluir a conexão.');
                setEstado('erro');
                return;
            }
            setEstado('ok');
            await refreshCompanySettings?.();
        } catch (e) {
            setErro(e.message ?? 'Falha de rede ao conectar.');
            setEstado('erro');
        }
    }, [refreshCompanySettings]);

    // ── Evento do Embedded Signup (traz waba_id e phone_number_id) ───────────
    useEffect(() => {
        const onMessage = (event) => {
            if (!String(event.origin).endsWith('facebook.com')) return;
            let data;
            try { data = JSON.parse(event.data); } catch { return; }   // não é nosso
            if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

            if (data.event === 'CANCEL') { setEstado('ocioso'); return; }
            if (data.event === 'ERROR') {
                setErro(data.data?.error_message || 'A Meta relatou um erro no cadastro.');
                setEstado('erro');
                return;
            }
            pecas.current.waba_id         = data.data?.waba_id ?? pecas.current.waba_id;
            pecas.current.phone_number_id = data.data?.phone_number_id ?? pecas.current.phone_number_id;
            enviarQuandoCompleto();
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [enviarQuandoCompleto]);

    const conectar = () => {
        if (!window.FB) return;
        pecas.current = { code: null, waba_id: null, phone_number_id: null };
        enviado.current = false;
        setErro(''); setEtapas([]); setEstado('conectando');

        window.FB.login((resp) => {
            const code = resp?.authResponse?.code;
            if (!code) { setEstado('ocioso'); return; }   // fechou a janela ou negou
            pecas.current.code = code;
            enviarQuandoCompleto();
        }, {
            config_id: CONFIG_ID,
            response_type: 'code',
            override_default_response_type: true,
            // featureType é o que pede COEXISTÊNCIA. Sem ele o fluxo registra o
            // número na Cloud API e TIRA o WhatsApp do celular da loja - o
            // oposto do que queremos. Valores copiados do link hospedado que a
            // própria Meta gera no painel do app.
            extras: {
                setup: {},
                featureType: 'whatsapp_business_app_onboarding',
                version: 'v4',
                sessionInfoVersion: '3',
            },
        });
    };

    return (
        <section className="settings-section card">
            <div className="section-title">
                <MessageSquare size={20} />
                <h2>Conectar WhatsApp</h2>
            </div>
            <div className="settings-form">

                {jaConectado && estado !== 'erro' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
                        <CheckCircle size={20} style={{ color: '#16a34a' }} />
                        <div>
                            <strong style={{ color: '#16a34a' }}>WhatsApp conectado</strong>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                Número: {companySettings.whatsapp_phone_number_id}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                        Conecte o WhatsApp da loja em um passo. Você entra com a conta do Facebook
                        do negócio e autoriza — a gente cuida do resto.
                    </p>
                )}

                {erro && (
                    <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.85rem', color: '#ef4444', marginBottom: '0.75rem' }}>
                        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {erro}
                    </p>
                )}

                {/* Relatório por etapa: mostra ONDE parou, em vez de "deu erro" */}
                {etapas.length > 0 && (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', fontSize: '0.82rem' }}>
                        {etapas.map((e, i) => (
                            <li key={i} style={{ color: e.ok ? '#16a34a' : '#ef4444', padding: '2px 0' }}>
                                {e.ok ? '✓' : '✕'} {e.etapa}{e.detalhe ? ` — ${e.detalhe}` : ''}
                            </li>
                        ))}
                    </ul>
                )}

                <button
                    className={jaConectado ? 'btn-outline' : 'btn-primary'}
                    onClick={conectar}
                    disabled={!sdkPronto || estado === 'conectando'}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    {estado === 'conectando'
                        ? <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Conectando…</>
                        : estado === 'erro'  ? <><RefreshCw size={18} /> Tentar novamente</>
                        : jaConectado        ? <><RefreshCw size={18} /> Reconectar</>
                        : <><MessageSquare size={18} /> Conectar WhatsApp</>}
                </button>

                {!sdkPronto && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 8 }}>
                        Carregando o conector do Facebook…
                    </p>
                )}
            </div>
        </section>
    );
};

export default ConectarWhatsApp;
