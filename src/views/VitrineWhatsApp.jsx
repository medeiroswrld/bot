import React, { useState } from 'react';
import { LayoutList, ToggleLeft, ToggleRight, Save, CheckCircle, Store } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Como o estoque aparece no WhatsApp do cliente.
//
// Duas formas, e a diferença entre elas é o que a tela precisa deixar claro:
//
//   Lista interativa — sai do banco no instante do envio. Nunca mostra carro
//                      vendido, porque não existe cópia pra ficar velha.
//   Catálogo         — vitrine nativa da Meta, com foto e preço. Depende de
//                      sincronização, e sincronização atrasada mostra carro que
//                      já foi vendido.
//
// Por isso a primeira nasce ligada e a segunda desligada.

const VitrineWhatsApp = () => {
  const { user, companySettings, refreshCompanySettings } = useAppContext();
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [catalogoId, setCatalogoId] = useState(companySettings?.catalogo_id ?? '');
  const [erro, setErro] = useState('');

  const lista = companySettings?.lista_interativa !== false;
  const catalogo = companySettings?.catalogo_habilitado === true;

  const gravar = async (campos) => {
    if (!user?.id) return;
    setErro(''); setSalvando(true);
    const { error } = await supabase
      .from('company_settings')
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    await refreshCompanySettings();
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  };

  const Chave = ({ ligado, onClick, titulo, texto, aviso }) => (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      border: '1px solid var(--border-color)', borderRadius: 12,
      padding: '14px 16px', marginBottom: 12,
    }}>
      <button onClick={onClick} disabled={salvando}
        title={ligado ? 'Desativar' : 'Ativar'}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          color: ligado ? 'var(--accent)' : '#94a3b8', display: 'flex', flexShrink: 0,
        }}>
        {ligado ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
      </button>
      <div>
        <strong style={{ fontSize: '0.9rem' }}>{titulo}</strong>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {texto}
        </p>
        {aviso && (
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#b45309', lineHeight: 1.5 }}>
            {aviso}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <section className="settings-section card">
      <div className="section-title">
        <LayoutList size={20} />
        <h2>Como o estoque aparece no WhatsApp</h2>
      </div>

      <div className="settings-form">
        <Chave
          ligado={lista}
          onClick={() => gravar({ lista_interativa: !lista })}
          titulo="Lista interativa (recomendado)"
          texto={'Em vez de escrever os carros um embaixo do outro, o bot manda um botão que abre um menu — o cliente toca no veículo em vez de digitar. Mostra até 10 por mensagem, que é o limite do WhatsApp.'}
        />

        <Chave
          ligado={catalogo}
          onClick={() => gravar({ catalogo_habilitado: !catalogo })}
          titulo="Catálogo do WhatsApp"
          texto={'A vitrine nativa, com foto e preço. Exige um catálogo criado no Commerce Manager da Meta e conectado ao seu número.'}
          aviso={'Enquanto o catálogo não estiver sincronizado com o estoque, ele pode mostrar veículo já vendido — e o cliente pede um carro que não existe mais.'}
        />

        {catalogo && (
          <div className="form-group" style={{ marginTop: 4 }}>
            <label>ID do catálogo (Commerce Manager)</label>
            <input
              value={catalogoId}
              placeholder="Ex.: 1234567890123456"
              onChange={(e) => setCatalogoId(e.target.value)}
            />
            <button className="btn-primary" disabled={salvando}
              onClick={() => gravar({ catalogo_id: catalogoId.trim() || null })}
              style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              {salvo ? <><CheckCircle size={18} /> Salvo!</> : <><Save size={18} /> Salvar ID</>}
            </button>
          </div>
        )}

        {erro && <p style={{ fontSize: '0.82rem', color: '#dc2626', marginTop: 8 }}>{erro}</p>}

        <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.75rem',
                    display: 'flex', gap: 6, alignItems: 'flex-start', lineHeight: 1.5 }}>
          <Store size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            As duas valem só no WhatsApp. No Instagram e no Messenger a lista continua
            saindo em texto — esses canais não têm menu interativo.
          </span>
        </p>
      </div>
    </section>
  );
};

export default VitrineWhatsApp;
