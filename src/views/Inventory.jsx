import React, { useState } from 'react';
import {
    Plus, Search, Eye, Pencil, Trash2, Image as ImageIcon,
    X, Gauge, Tag, CheckCircle2, ShoppingCart, Package, Camera,
    Video, Loader2
, CalendarDays, Printer } from 'lucide-react';
import { useAppContext, getTodayStr } from '../context/AppContext.jsx';
import { MODELO_PADRAO, montarContrato, dadosDoContrato, imprimirContrato, formatarCPF, cpfValido } from '../lib/contrato.js';
import { supabase } from '../lib/supabase.js';
import MatchFoundModal from './MatchFoundModal.jsx';

const CarPlaceholder = () => (
    <div className="car-placeholder">
        <Camera size={36} strokeWidth={1.5} />
        <span>Sem foto</span>
    </div>
);

const StatusBadge = ({ status }) => {
    const map = {
        disponivel: { label: 'Disponível', bg: '#ecfdf5', color: '#059669' },
        reservado: { label: 'Reservado', bg: '#fff7ed', color: '#d97706' }
    };
    const s = map[status] || map.disponivel;
    return <span className="inv-status-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const EMPTY_CAR = { brand: '', model: '', version: '', year: '', model_year: '', price: '', km: '', transmission: 'Automático', fuel: 'Flex', color: '', vehicle_type: 'carro', status: 'disponivel', description: '', chassi: '', renavam: '', images: [], specsImage: null, video: null };

// Parse preço no formato brasileiro ("198.000" ou "198.000,00" ou "198000") → número
const parsePriceBR = (value) => {
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
};

// Consulta avulsa de placa — "que carro é esse?", sem compromisso de cadastrar.
// Serve pra avaliar carro que o cliente ofereceu na troca ou que a loja pensa em
// comprar. Não grava nada no estoque; quem cadastra é o botão do rodapé.
const ConsultaPlacaModal = ({ onClose, onAdicionar }) => {
    const { inventoryCars } = useAppContext();
    const [placa, setPlaca] = useState('');
    const [buscando, setBuscando] = useState(false);
    const [erro, setErro] = useState('');
    const [dados, setDados] = useState(null);

    // Placa já cadastrada não deve virar duplicata — avisa e leva pro que existe.
    const jaNoEstoque = dados && (inventoryCars || []).find(c =>
        String(c.brand || '').toLowerCase() === String(dados.marca || '').toLowerCase() &&
        String(c.model || '').toLowerCase().includes(String(dados.modelo || '').toLowerCase().split(' ')[0]) &&
        String(c.year) === String(dados.ano),
    );

    const consultar = async () => {
        const limpa = placa.replace(/[^A-Z0-9]/g, '');
        if (limpa.length < 7) return;
        setBuscando(true); setErro(''); setDados(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/consultar-placa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
                body: JSON.stringify({ placa: limpa }),
            });
            const j = await res.json();
            if (!res.ok) { setErro(j.error || 'Não consegui consultar essa placa.'); return; }
            setDados(j);
        } catch (e) {
            setErro(e.message ?? 'Falha na consulta.');
        } finally { setBuscando(false); }
    };

    // Só aparece o que a consulta devolveu — fornecedor que não manda o campo
    // some da lista em vez de mostrar linha vazia.
    const LINHAS = [
        ['Marca', 'marca'],
        ['Modelo', 'modelo'],
        ['Ano fabricação', 'ano'],
        ['Ano modelo', 'ano_modelo'],
        ['Cor', 'cor'],
        ['Combustível', 'combustivel'],
        ['Cilindradas', 'cilindradas'],
        ['Categoria', 'sub_segmento'],
        ['Emplacado em', 'emplacadoEm'],
        ['Chassi', 'chassi'],
    ];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Consultar veículo</h2>
                    <button className="icon-btn" onClick={onClose}><X size={18} /></button>
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                    <div className="form-group">
                        <label>Placa</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input
                                type="text" value={placa} maxLength={8} autoFocus
                                onChange={e => setPlaca(e.target.value.toUpperCase())}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); consultar(); } }}
                                placeholder="ABC1D23"
                                style={{ maxWidth: 160, textTransform: 'uppercase', fontFamily: 'monospace' }}
                            />
                            <button className="btn-primary" onClick={consultar} disabled={buscando || placa.length < 7}>
                                {buscando ? 'Consultando…' : 'Consultar'}
                            </button>
                        </div>
                        {erro && <p className="error-message">{erro}</p>}
                    </div>

                    {dados && (
                        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                            {LINHAS.map(([rotulo, campo]) => (campo === 'emplacadoEm'
                                ? [dados.municipio, dados.uf].filter(Boolean).join(' / ')
                                : dados[campo]) && (
                                <div key={campo} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.88rem' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{rotulo}</span>
                                    <strong>{campo === 'emplacadoEm'
                                        ? [dados.municipio, dados.uf].filter(Boolean).join(' / ')
                                        : dados[campo]}</strong>
                                </div>
                            ))}
                            {dados.cache && (
                                <p className="text-muted" style={{ fontSize: '0.76rem', marginTop: 8 }}>
                                    Já consultada antes — sem custo novo.
                                </p>
                            )}
                            {jaNoEstoque && (
                                <p style={{ fontSize: '0.82rem', color: '#b45309', marginTop: 10 }}>
                                    ⚠ Parece que esse veículo já está no seu estoque
                                    ({jaNoEstoque.brand} {jaNoEstoque.model} {jaNoEstoque.year}).
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Fechar</button>
                    {dados && (
                        <button className="btn-primary" onClick={() => onAdicionar({
                            brand: dados.marca || '', model: dados.modelo || '',
                            year: dados.ano || '', color: dados.cor || '',
                            fuel: dados.combustivel || 'Flex', placa: dados.placa,
                            vehicle_type: dados.tipo || 'carro',
                            model_year: dados.ano_modelo || '', chassi: dados.chassi || '',
                        })}>
                            Adicionar ao estoque
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const CarFormModal = ({ car, isEdit, inicial, onClose, onSave }) => {
    const { addToast } = useAppContext();
    const [form, setForm] = useState(car ? {
        ...car,
        price: car.price != null ? Number(car.price).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '',
        km:    car.km    != null ? Number(car.km).toLocaleString('pt-BR',    { maximumFractionDigits: 0 }) : '',
        vehicle_type: car.vehicle_type || 'carro',
        images: (car.images || (car.image ? [car.image] : [])).map(img => typeof img === 'string' ? { preview: img, file: null } : img),
        specsImage: car.specs_image_url ? { url: car.specs_image_url } : null,
        video: car.video_url ? { url: car.video_url } : null,
    } : { ...EMPTY_CAR, ...(inicial ?? {}) });
    const [errors, setErrors] = useState({});
    // Vindo da consulta por placa, o campo já nasce preenchido e não reconsulta.
    const [placa, setPlaca] = useState(inicial?.placa ?? '');
    const [buscandoPlaca, setBuscandoPlaca] = useState(false);
    const [erroPlaca, setErroPlaca] = useState('');
    const [saving, setSaving] = useState(false);

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    };

    const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const MAX_SIZE_BYTES = 5 * 1024 * 1024;

    const handleImageUpload = (e) => {
        const files = Array.from(e.target.files);
        const currentImagesCount = form.images?.length || 0;

        if (currentImagesCount + files.length > 8) {
            addToast('Limite de 8 fotos atingido.', 'error');
            return;
        }

        files.forEach(file => {
            if (!ALLOWED_TYPES.includes(file.type)) {
                addToast(`Formato não suportado (${file.name}). Use JPEG, PNG ou WEBP.`, 'error');
                return;
            }
            if (file.size > MAX_SIZE_BYTES) {
                addToast(`Imagem muito grande (${file.name}). Máx 5 MB.`, 'error');
                return;
            }
            const preview = URL.createObjectURL(file);
            setForm(prev => ({ ...prev, images: [...(prev.images || []), { preview, file }] }));
        });
    };

    const removeImage = (index) => {
        setForm(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }));
    };

    // ── Foto de especificações (JPG/PNG/WEBP até 5MB) ──────────────────────────
    const SPECS_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const handleSpecsUpload = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!SPECS_TYPES.includes(file.type)) { addToast('Formato inválido. Use JPEG, PNG ou WEBP.', 'error'); return; }
        if (file.size > 5 * 1024 * 1024) { addToast('Imagem muito grande. Máximo 5MB.', 'error'); return; }
        setForm(prev => ({ ...prev, specsImage: { file, preview: URL.createObjectURL(file) } }));
    };
    const removeSpecs = () => setForm(prev => ({ ...prev, specsImage: null }));

    // ── Vídeo do veículo (MP4 até 16MB) ────────────────────────────────────────
    const handleVideoUpload = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.type !== 'video/mp4') { addToast('Formato inválido. Use MP4.', 'error'); return; }
        if (file.size > 16 * 1024 * 1024) { addToast('Vídeo muito grande. Máximo 16MB. Tente comprimir o vídeo ou reduzir a duração.', 'error'); return; }
        setForm(prev => ({ ...prev, video: { file, preview: URL.createObjectURL(file) } }));
    };
    const removeVideo = () => setForm(prev => ({ ...prev, video: null }));

    // Consulta paga: só dispara no clique, nunca enquanto digita.
    const buscarPlaca = async () => {
        const limpa = placa.replace(/[^A-Z0-9]/g, '');
        if (limpa.length < 7) return;
        setBuscandoPlaca(true);
        setErroPlaca('');
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/consultar-placa`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session?.access_token ?? ''}`,
                },
                body: JSON.stringify({ placa: limpa }),
            });
            const dados = await res.json();
            if (!res.ok) { setErroPlaca(dados.error || 'Não consegui consultar essa placa.'); return; }

            // Não sobrescreve o que o lojista já digitou: se ele corrigiu o
            // modelo à mão, a consulta não pode desfazer.
            setForm(prev => ({
                ...prev,
                brand: prev.brand || dados.marca || '',
                model: prev.model || dados.modelo || '',
                year:  prev.year  || dados.ano || '',
                color: prev.color || dados.cor || '',
                fuel:  dados.combustivel || prev.fuel,
                vehicle_type: dados.tipo || prev.vehicle_type,
                // Chassi e ano do modelo entram no cadastro porque o contrato de
                // venda pede os dois. Antes a consulta trazia e a gente jogava
                // fora, e o contrato saia com linha em branco.
                model_year: prev.model_year || dados.ano_modelo || '',
                chassi: prev.chassi || dados.chassi || '',
            }));
            addToast(dados.cache ? 'Dados preenchidos (já consultada antes).' : 'Dados do veículo preenchidos.', 'success');
        } catch (e) {
            setErroPlaca(e.message ?? 'Falha na consulta.');
        } finally {
            setBuscandoPlaca(false);
        }
    };

    const handleSubmit = async () => {
        const newErrors = {};
        if (!form.brand) newErrors.brand = true;
        if (!form.model) newErrors.model = true;
        if (!form.price) newErrors.price = true;
        if (!form.year) newErrors.year = true;

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            addToast('Preencha os campos obrigatórios.', 'error');
            return;
        }

        setSaving(true);
        try {
            await onSave({
                ...form,
                // A caixa de consulta E o campo de placa: ter dois campos de placa
                // na mesma tela seria pedir para divergirem.
                plate: String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
                price: parsePriceBR(form.price),
                km:    parsePriceBR(form.km),
                status: form.status || 'disponivel',
                images: form.images?.length > 0 ? form.images : [],
                specsImage: form.specsImage,
                video: form.video,
            });
            onClose();
        } catch (err) {
            // O AppContext já exibe o toast de erro específico. Mantém o modal aberto.
            console.error('[Inventory] erro ao salvar veículo:', err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEdit ? 'Editar informações' : 'Novo veículo'}</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="settings-form">
                    <div className="form-group">
                        <label>Fotos do Veículo ({form.images?.length || 0}/8)</label>
                        <div className="image-upload-grid">
                            {(form.images || []).map((img, index) => (
                                <div key={index} className="image-preview-item">
                                    <img src={img.preview || img} alt={`Preview ${index}`} />
                                    <button className="remove-image-btn" onClick={() => removeImage(index)}><Trash2 size={14} /></button>
                                </div>
                            ))}
                            {(!form.images || form.images.length < 8) && (
                                <div className="upload-card-btn" onClick={() => document.getElementById('car-images-upload').click()}>
                                    <Plus size={24} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Adicionar</span>
                                    <input id="car-images-upload" type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple style={{ display: 'none' }} onChange={handleImageUpload} />
                                </div>
                            )}
                        </div>
                        {form.images?.length === 8 && <p className="error-message" style={{ color: '#f59e0b' }}>Limite de 8 fotos atingido.</p>}
                    </div>

                    {/* ── Foto de Especificações (usada pelo bot) ──────────────────── */}
                    <div className="form-group">
                        <label>Foto de Especificações</label>
                        {form.specsImage ? (
                            <div style={{ width: 'fit-content' }}>
                                <img
                                    src={form.specsImage.preview || form.specsImage.url}
                                    alt="Foto de especificações"
                                    style={{ maxWidth: 240, maxHeight: 160, borderRadius: 8, border: '1px solid var(--border)', objectFit: 'cover', display: 'block' }}
                                />
                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button type="button" className="btn-secondary" onClick={() => document.getElementById('specs-upload').click()}>Trocar foto</button>
                                    <button type="button" className="btn-secondary" style={{ color: '#dc2626' }} onClick={removeSpecs}>Remover</button>
                                </div>
                            </div>
                        ) : (
                            <div className="upload-card-btn" style={{ width: 'fit-content', padding: '1rem 1.5rem' }} onClick={() => document.getElementById('specs-upload').click()}>
                                <ImageIcon size={22} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Enviar foto de specs</span>
                            </div>
                        )}
                        <input id="specs-upload" type="file" accept="image/jpeg,image/jpg,image/png,image/webp" style={{ display: 'none' }} onChange={handleSpecsUpload} />
                        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
                            Esta é a foto que o bot vai enviar quando o cliente perguntar sobre este veículo. Use um card com as especificações (preço, ano, km, câmbio, etc.).
                        </p>
                    </div>

                    {/* ── Vídeo do Veículo (usado pelo bot) ────────────────────────── */}
                    <div className="form-group">
                        <label>Vídeo do Veículo</label>
                        {form.video ? (
                            <div style={{ width: 'fit-content' }}>
                                <video
                                    src={form.video.preview || form.video.url}
                                    controls
                                    style={{ maxWidth: 300, maxHeight: 190, borderRadius: 8, border: '1px solid var(--border)', display: 'block', background: '#000' }}
                                />
                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button type="button" className="btn-secondary" onClick={() => document.getElementById('video-upload').click()}>Trocar vídeo</button>
                                    <button type="button" className="btn-secondary" style={{ color: '#dc2626' }} onClick={removeVideo}>Remover</button>
                                </div>
                            </div>
                        ) : (
                            <div className="upload-card-btn" style={{ width: 'fit-content', padding: '1rem 1.5rem' }} onClick={() => document.getElementById('video-upload').click()}>
                                <Video size={22} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Enviar vídeo MP4</span>
                            </div>
                        )}
                        <input id="video-upload" type="file" accept="video/mp4" style={{ display: 'none' }} onChange={handleVideoUpload} />
                        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
                            Vídeo curto mostrando o veículo (recomendado: até 60 segundos, máx 16MB). O bot vai enviar este vídeo junto com a foto de especificações.
                        </p>
                    </div>

                    <div className="form-group">
                        <label>Observações / Descrição</label>
                        <textarea
                            rows={2}
                            value={form.description || ''}
                            onChange={e => handleChange('description', e.target.value)}
                            placeholder="Ex: Único dono, revisado, IPVA 2026 pago, chave reserva..."
                            style={{ resize: 'vertical', fontFamily: 'inherit' }}
                        />
                    </div>

                    {/* Preenche marca/modelo/ano/cor pela placa. Fica ANTES dos
                        campos porque é o atalho: quem tem a placa não digita nada. */}
                    <div className="form-group">
                        <label>Buscar pela placa</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <input
                                type="text"
                                value={placa}
                                onChange={e => setPlaca(e.target.value.toUpperCase())}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarPlaca(); } }}
                                placeholder="ABC1234"
                                maxLength={8}
                                style={{ maxWidth: 160, textTransform: 'uppercase', fontFamily: 'monospace' }}
                            />
                            <button type="button" className="btn-secondary" onClick={buscarPlaca} disabled={buscandoPlaca || placa.length < 7}>
                                {buscandoPlaca ? 'Buscando…' : 'Preencher'}
                            </button>
                        </div>
                        {erroPlaca && <p className="error-message">{erroPlaca}</p>}
                        <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
                            Preenche marca, modelo, ano e cor. Confira antes de salvar — preço, km e fotos você completa.
                        </p>
                    </div>

                    <div className="form-row">
                        <div className={`form-group ${errors.brand ? 'has-error' : ''}`}>
                            <label>Marca *</label>
                            <input type="text" value={form.brand} onChange={e => handleChange('brand', e.target.value)} placeholder="Ex: Toyota" />
                        </div>
                        <div className={`form-group ${errors.model ? 'has-error' : ''}`}>
                            <label>Modelo *</label>
                            <input type="text" value={form.model} onChange={e => handleChange('model', e.target.value)} placeholder="Ex: Corolla" />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Versão</label><input type="text" value={form.version} onChange={e => handleChange('version', e.target.value)} placeholder="Ex: XEi 2.0 Flex" /></div>
                        <div className="form-group"><label>Status</label>
                            <select value={form.status} onChange={e => handleChange('status', e.target.value)}>
                                <option value="disponivel">Disponível</option>
                                <option value="reservado">Reservado</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Tipo de Veículo</label>
                            <select value={form.vehicle_type || 'carro'} onChange={e => handleChange('vehicle_type', e.target.value)}>
                                <option value="carro">🚗 Carro</option>
                                <option value="moto">🏍 Moto</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className={`form-group ${errors.year ? 'has-error' : ''}`}>
                            <label>Ano *</label>
                            <input type="text" value={form.year} onChange={e => handleChange('year', e.target.value)} placeholder="Ex: 2024" />
                        </div>
                        <div className={`form-group ${errors.price ? 'has-error' : ''}`}>
                            <label>Valor (R$) *</label>
                            <input type="text" inputMode="numeric" value={form.price} onChange={e => handleChange('price', e.target.value)} placeholder="Ex: 198000 ou 198.000" />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Quilometragem</label><input type="text" value={form.km} onChange={e => handleChange('km', e.target.value)} placeholder="15.000" /></div>
                        <div className="form-group"><label>Câmbio</label>
                            <select value={form.transmission} onChange={e => handleChange('transmission', e.target.value)}>
                                <option>Automático</option><option>Manual</option><option>CVT</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Combustível</label>
                            <select value={form.fuel} onChange={e => handleChange('fuel', e.target.value)}>
                                <option>Flex</option><option>Gasolina</option><option>Diesel</option><option>Elétrico</option><option>Híbrido</option>
                            </select>
                        </div>
                        <div className="form-group"><label>Cor</label><input type="text" value={form.color} onChange={e => handleChange('color', e.target.value)} placeholder="Prata" /></div>
                        {/* Documento do veiculo: o contrato de venda pede chassi e
                            renavam, e ate aqui nao havia onde guardar — os marcadores
                            saiam em branco. A consulta por placa preenche chassi e ano
                            do modelo; renavam nenhum fornecedor devolve. */}
                        <div className="form-group"><label>Ano do modelo</label><input type="number" value={form.model_year} onChange={e => handleChange('model_year', e.target.value)} placeholder="2021" /></div>
                        <div className="form-group"><label>Chassi</label><input type="text" value={form.chassi} onChange={e => handleChange('chassi', e.target.value.toUpperCase())} placeholder="Vem da consulta por placa" style={{ fontFamily: 'monospace' }} /></div>
                        <div className="form-group"><label>Renavam</label><input type="text" value={form.renavam} onChange={e => handleChange('renavam', e.target.value)} placeholder="Preenchimento manual" /></div>
                    </div>
                    <div className="modal-footer" style={{ marginTop: '1rem' }}>
                        <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
                        <button className="btn-primary" onClick={handleSubmit} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}>
                            {saving && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
                            {saving ? 'Salvando...' : (isEdit ? 'Salvar Alterações' : 'Registrar Veículo')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Consulta de placa isolada: o SellModal é o terceiro lugar do arquivo que
// precisa dela, e repetir o fetch pela terceira vez era pedir para um deles
// ficar para trás numa mudança futura.
const consultarPlacaApi = async (placa) => {
    const limpa = String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/consultar-placa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ placa: limpa }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Não consegui consultar essa placa.');
    return j;
};

const SellModal = ({ car, onClose, onConfirm }) => {
    const { addToast } = useAppContext();
    const [salePrice, setSalePrice] = useState(car ? car.price : 0);
    const [saleDate, setSaleDate] = useState(getTodayStr());
    const [sellerName, setSellerName] = useState('');
    const [error, setError] = useState(false);
    // Dados do comprador: entram aqui porque e o unico momento em que a loja
    // realmente os tem em maos. Pedir depois significa nao pedir.
    const [comprador, setComprador] = useState({
        buyer_name: '', buyer_cpf: '', buyer_rg: '',
        buyer_address: '', buyer_phone: '', payment_terms: '',
        trade_in_plate: '', trade_in_brand: '', trade_in_model: '', trade_in_year: '',
        trade_in_color: '', trade_in_chassi: '', trade_in_renavam: '',
        trade_in_km: '', trade_in_value: '',
    });
    const [erroCpf, setErroCpf] = useState('');
    const [buscandoTroca, setBuscandoTroca] = useState(false);
    const [erroTroca, setErroTroca] = useState('');

    if (!car) return null;

    const setC = (campo, valor) => setComprador(c => ({ ...c, [campo]: valor }));

    // Puxa o veículo da troca pela placa. Não sobrescreve o que ja foi digitado:
    // se o vendedor corrigiu o modelo a mao, a consulta nao pode desfazer.
    const buscarTroca = async () => {
        const limpa = String(comprador.trade_in_plate).replace(/[^A-Za-z0-9]/g, '');
        if (limpa.length < 7) { setErroTroca('Placa incompleta.'); return; }
        setBuscandoTroca(true); setErroTroca('');
        try {
            const d = await consultarPlacaApi(limpa);
            setComprador(c => ({
                ...c,
                trade_in_brand:  c.trade_in_brand  || d.marca || '',
                trade_in_model:  c.trade_in_model  || d.modelo || '',
                trade_in_year:   c.trade_in_year   || d.ano_modelo || d.ano || '',
                trade_in_color:  c.trade_in_color  || d.cor || '',
                trade_in_chassi: c.trade_in_chassi || d.chassi || '',
            }));
            addToast(d.cache ? 'Dados da troca preenchidos (placa ja consultada).' : 'Dados da troca preenchidos.', 'success');
        } catch (e) {
            setErroTroca(e.message);
        } finally {
            setBuscandoTroca(false);
        }
    };

    const handleConfirm = () => {
        if (!sellerName.trim()) {
            setError(true);
            addToast('O nome do vendedor é obrigatório.', 'error');
            return;
        }
        // CPF so e validado se preenchido: venda pode ser registrada sem contrato,
        // e travar isso impediria de fechar a venda no sistema.
        if (comprador.buyer_cpf && !cpfValido(comprador.buyer_cpf)) {
            setErroCpf('CPF inválido — confira os dígitos.');
            addToast('CPF do comprador inválido.', 'error');
            return;
        }
        onConfirm(car.id, salePrice, saleDate, sellerName, comprador);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Registrar Venda</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="sell-modal-body">
                    <div className="sell-car-info">
                        {car.images?.[0] ? <img src={car.images[0]} alt={car.model} className="sell-car-thumb" /> : <div className="sell-car-thumb" style={{display:'flex',alignItems:'center',justifyContent:'center',background:'var(--input-bg)',borderRadius:'8px',width:'64px',height:'64px'}}><Camera size={24} color="#94a3b8" /></div>}
                        <div>
                            <h3>{car.brand} {car.model}</h3>
                            <p className="text-muted">{car.version} • {car.year}</p>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Valor Fechado (R$)</label>
                        <input type="number" value={salePrice} onChange={e => setSalePrice(Number(e.target.value))} />
                    </div>
                    <div className="form-group">
                        <label>Data da Venda</label>
                        <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
                    </div>
                    <div className={`form-group ${error ? 'has-error' : ''}`}>
                        <label>Vendedor *</label>
                        <input 
                            type="text" 
                            placeholder="Nome do vendedor" 
                            value={sellerName} 
                            onChange={e => { setSellerName(e.target.value); if (error) setError(false); }} 
                        />
                        {error && <p className="error-message">Campo obrigatório</p>}
                    </div>

                    <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0 12px', paddingTop: 12 }}>
                        <p style={{ margin: '0 0 2px', fontSize: '0.85rem', fontWeight: 600 }}>Dados do comprador</p>
                        <p style={{ margin: '0 0 10px', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
                            Opcional para registrar a venda, obrigatório para gerar o contrato.
                        </p>

                        <div className="form-group">
                            <label>Nome completo</label>
                            <input type="text" value={comprador.buyer_name}
                                onChange={e => setC('buyer_name', e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ flex: '1 1 150px' }}>
                                <label>CPF</label>
                                <input type="text" value={formatarCPF(comprador.buyer_cpf)} placeholder="000.000.000-00"
                                    onChange={e => { setC('buyer_cpf', e.target.value); setErroCpf(''); }} />
                                {erroCpf && <p className="error-message">{erroCpf}</p>}
                            </div>
                            <div className="form-group" style={{ flex: '1 1 130px' }}>
                                <label>RG</label>
                                <input type="text" value={comprador.buyer_rg}
                                    onChange={e => setC('buyer_rg', e.target.value)} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Endereço</label>
                            <input type="text" value={comprador.buyer_address}
                                onChange={e => setC('buyer_address', e.target.value)} />
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ flex: '1 1 150px' }}>
                                <label>Telefone</label>
                                <input type="text" value={comprador.buyer_phone}
                                    onChange={e => setC('buyer_phone', e.target.value)} />
                            </div>
                            <div className="form-group" style={{ flex: '1 1 170px' }}>
                                <label>Forma de pagamento</label>
                                <input type="text" placeholder="Ex: à vista, financiado em 48x"
                                    value={comprador.payment_terms}
                                    onChange={e => setC('payment_terms', e.target.value)} />
                            </div>
                        </div>

                        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.9rem' }}>Veículo na troca</p>
                            <p style={{ margin: '0 0 10px', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                Opcional. Digite a placa e o resto vem sozinho.
                            </p>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div className="form-group" style={{ flex: '0 0 140px', marginBottom: 0 }}>
                                    <label>Placa</label>
                                    <input type="text" maxLength={8} placeholder="ABC1D23"
                                        value={comprador.trade_in_plate}
                                        onChange={e => setC('trade_in_plate', e.target.value.toUpperCase())}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarTroca(); } }}
                                        style={{ textTransform: 'uppercase', fontFamily: 'monospace' }} />
                                </div>
                                <button type="button" className="btn-secondary" onClick={buscarTroca}
                                    disabled={buscandoTroca || comprador.trade_in_plate.replace(/[^A-Za-z0-9]/g, '').length < 7}
                                    style={{ marginBottom: 2 }}>
                                    {buscandoTroca ? 'Buscando…' : 'Buscar'}
                                </button>
                            </div>
                            {erroTroca && <p className="error-message">{erroTroca}</p>}

                            {comprador.trade_in_plate && (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                                    <div className="form-group" style={{ flex: '1 1 130px' }}>
                                        <label>Marca</label>
                                        <input type="text" value={comprador.trade_in_brand}
                                            onChange={e => setC('trade_in_brand', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: '1 1 160px' }}>
                                        <label>Modelo</label>
                                        <input type="text" value={comprador.trade_in_model}
                                            onChange={e => setC('trade_in_model', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: '0 1 90px' }}>
                                        <label>Ano</label>
                                        <input type="text" value={comprador.trade_in_year}
                                            onChange={e => setC('trade_in_year', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: '0 1 110px' }}>
                                        <label>Cor</label>
                                        <input type="text" value={comprador.trade_in_color}
                                            onChange={e => setC('trade_in_color', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: '1 1 180px' }}>
                                        <label>Chassi</label>
                                        <input type="text" value={comprador.trade_in_chassi}
                                            onChange={e => setC('trade_in_chassi', e.target.value)}
                                            style={{ fontFamily: 'monospace' }} />
                                    </div>
                                    <div className="form-group" style={{ flex: '1 1 140px' }}>
                                        {/* Nenhuma consulta por placa devolve Renavam. Fica manual, e o
                                            rotulo diz isso pra ninguem ficar esperando aparecer. */}
                                        <label>Renavam (manual)</label>
                                        <input type="text" value={comprador.trade_in_renavam}
                                            onChange={e => setC('trade_in_renavam', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: '0 1 110px' }}>
                                        <label>Km</label>
                                        <input type="number" value={comprador.trade_in_km}
                                            onChange={e => setC('trade_in_km', e.target.value)} />
                                    </div>
                                    <div className="form-group" style={{ flex: '0 1 130px' }}>
                                        <label>Valor avaliado</label>
                                        <input type="number" step="0.01" value={comprador.trade_in_value}
                                            onChange={e => setC('trade_in_value', e.target.value)} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancelar</button>
                    <button className="btn-primary" style={{ background: '#059669' }} onClick={handleConfirm}>
                        <CheckCircle2 size={18} /> Confirmar Venda
                    </button>
                </div>
            </div>
        </div>
    );
};

// Contrato pronto pra conferir e imprimir. Aparece logo depois da venda, que e
// quando a loja tem o comprador na frente — mandar procurar depois vira
// "imprimo amanha" e nao imprime.
const ContratoModal = ({ carro, venda, onClose }) => {
    const { companySettings } = useAppContext();
    const modelo = companySettings?.contract_template || MODELO_PADRAO;
    const html = montarContrato(modelo, dadosDoContrato({ loja: companySettings, carro, venda }));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
                <div className="modal-header">
                    <h2>Contrato de Compra e Venda</h2>
                </div>
                <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', background: '#fff', color: '#111', padding: 22, borderRadius: 8 }}>
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                </div>
                <div className="modal-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                    <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                        Confira antes de imprimir. Os traços indicam dados que faltaram no cadastro —
                        preencha à caneta ou complete no sistema e gere de novo.
                    </p>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                        <button className="btn-secondary" onClick={onClose}>Fechar</button>
                        <button className="btn-primary" onClick={() => imprimirContrato(html)}>
                            <Printer size={18} /> Imprimir
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DetailDrawer = ({ car, onClose }) => {
    const images = car.images?.length > 0 ? car.images : [];
    const [activeImg, setActiveImg] = useState(0);

    if (!car) return null;
    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Detalhes do Veículo</h2>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="drawer-body">
                    <div className="detail-gallery">
                        <div className="gallery-main">
                            {images.length > 0 ? (
                                <img src={images[activeImg]} alt={car.model} />
                            ) : (
                                <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'280px',background:'var(--input-bg)',borderRadius:'12px',color:'#94a3b8',gap:'0.5rem'}}>
                                    <Camera size={48} strokeWidth={1.5} />
                                    <span style={{fontSize:'0.875rem',fontWeight:500}}>Nenhuma foto cadastrada</span>
                                </div>
                            )}
                        </div>
                        {images.length > 1 && (
                            <div className="gallery-thumbs">
                                {images.map((img, idx) => (
                                    <div 
                                        key={idx} 
                                        className={`thumb-item ${activeImg === idx ? 'active' : ''}`}
                                        onClick={() => setActiveImg(idx)}
                                    >
                                        <img src={img} alt={`Thumb ${idx}`} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{car.brand} {car.model}</h3>
                    <p className="text-muted" style={{ marginBottom: '1.5rem' }}>{car.version} • {car.year}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {[
                            ['Preço', `R$ ${Number(car.price).toLocaleString('pt-BR')}`],
                            ['Quilometragem', `${Number(car.km).toLocaleString('pt-BR')} km`],
                            ['Câmbio', car.transmission],
                            ['Combustível', car.fuel],
                            ['Cor', car.color],
                            ['Status', car.status === 'disponivel' ? 'Disponível' : 'Reservado']
                        ].map(([label, value]) => (
                            <div key={label}>
                                <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>{label}</p>
                                <p style={{ fontWeight: 600 }}>{value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
    <div className="modal-overlay" onClick={onCancel}>
        <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', lineHeight: 1.4 }}>{message}</p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
                    <button className="btn-primary" style={{ background: '#ef4444' }} onClick={onConfirm}>Excluir</button>
                </div>
            </div>
        </div>
    </div>
);


const Inventory = () => {
    const { inventory, addInventoryCar, updateInventoryCar, removeInventoryCar, sellCar, waitingListTemplateReady, notifyWaitingListMatch } = useAppContext();
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('todos');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showConsulta, setShowConsulta] = useState(false);
    // Dados vindos da consulta avulsa, pra abrir o cadastro já preenchido.
    const [preenchido, setPreenchido] = useState(null);
    const [editCar, setEditCar] = useState(null);
    const [sellCarObj, setSellCarObj] = useState(null);
    const [viewCar, setViewCar] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [matchModalData, setMatchModalData] = useState(null);

    const filtered = inventory.filter(c => {
        const matchSearch = `${c.brand} ${c.model} ${c.version} ${c.year}`.toLowerCase().includes(search.toLowerCase());
        const matchStatus = filterStatus === 'todos' || c.status === filterStatus;
        return matchSearch && matchStatus;
    });

    // Após salvar um carro, busca interesses na lista de espera que batem
    const checkMatches = async (car) => {
        if (!car?.id) return;
        try {
            const { data, error } = await supabase.functions.invoke('match-interests-for-car', {
                body: { car_id: car.id },
            });
            if (error) { console.error('[Inventory] match error:', error); return; }
            const count = data?.matches_count ?? 0;
            if (count === 0) return;

            const AUTO_LIMIT = 20;
            // Auto-dispara só se o template estiver pronto (aprovado + selecionado)
            // E dentro do limite de segurança. Senão, abre o modal pra revisar.
            if (waitingListTemplateReady && count <= AUTO_LIMIT) {
                await notifyWaitingListMatch(car.id, data.matches.map(m => m.id), { auto: true, carName: data.car?.name });
                return; // sem modal — o toast é o recibo
            }
            setMatchModalData(data);
        } catch (e) {
            console.error('[Inventory] match exception:', e);
        }
    };

    const handleAddCar = async (carData) => { const car = await addInventoryCar(carData); await checkMatches(car); };
    const handleEditCar = async (carData) => { const car = await updateInventoryCar(editCar.id, carData); await checkMatches(car); };
    const handleSell = async (carId, price, date, seller, comprador) => {
        const carro = sellCarObj;
        await sellCar(carId, price, date, seller, comprador);
        setSellCarObj(null);
        // Contrato so faz sentido com nome e CPF: sem isso sairia um documento
        // cheio de linha em branco, pior que nao oferecer.
        if (comprador?.buyer_name && comprador?.buyer_cpf) {
            setContratoDe({ carro: { ...carro, ...comprador }, venda: { ...comprador, salePrice: price, saleDate: date, sellerName: seller } });
        }
    };

    // Contrato pendente de impressao (aparece logo apos confirmar a venda).
    const [contratoDe, setContratoDe] = useState(null);
    const handleDelete = (carId) => setConfirmDeleteId(carId);
    const confirmDelete = () => { removeInventoryCar(confirmDeleteId); setConfirmDeleteId(null); };

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Meu Estoque</h1>
                    <p>Gerencie seus veículos. <strong>{filtered.length}</strong> listado{filtered.length !== 1 ? 's' : ''}.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                    <button className="btn-secondary" onClick={() => setShowConsulta(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Search size={17} /> Consultar placa
                    </button>
                    <button className="btn-primary" onClick={() => setShowAddModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Plus size={20} /> Novo Veículo
                    </button>
                </div>
            </header>

            <div className="inv-toolbar">
                <div className="inv-search">
                    <Search size={18} />
                    <input type="text" placeholder="Buscar por marca, modelo ou versão..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="inv-filters">
                    {[['todos', 'Todos'], ['disponivel', 'Disponíveis'], ['reservado', 'Reservados']].map(([key, label]) => (
                        <button key={key} className={`inv-filter-btn ${filterStatus === key ? 'active' : ''}`} onClick={() => setFilterStatus(key)}>{label}</button>
                    ))}
                </div>
            </div>

            <div className="inv-grid">
                {filtered.map(car => (
                    <div key={car.id} className="inv-card card">
                        <div className="inv-card-img">
                            {car.images?.length > 0 ? (
                                <img src={car.images[0]} alt={`${car.brand} ${car.model}`} />
                            ) : (
                                <CarPlaceholder />
                            )}
                            <StatusBadge status={car.status} />
                            {car.vehicle_type === 'moto' && (
                                <span style={{ position: 'absolute', top: 8, left: 8, background: '#7c3aed', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>MOTO</span>
                            )}
                            {car.images?.length > 1 && <div className="image-count-overlay"><ImageIcon size={12} /> {car.images.length}</div>}
                        </div>
                        <div className="inv-card-body">
                            <div className="inv-card-top">
                                <div>
                                    <h3 className="inv-card-name">{car.brand} {car.model}</h3>
                                    <p className="inv-card-version">{car.version}</p>
                                </div>
                                <span className="inv-card-year">{car.year}</span>
                            </div>
                            <div className="inv-card-price">R$ {Number(car.price).toLocaleString('pt-BR')}</div>
                            <div className="inv-card-specs">
                                <span><Gauge size={14} /> {Number(car.km).toLocaleString('pt-BR')} km</span>
                                <span><Tag size={14} /> {car.transmission}</span>
                                <span>{car.fuel}</span>
                            </div>
                            {car.created_at && (() => {
                                // Dias parado importa mais que a data crua: carro
                                // encalhado e o que precisa de decisao (baixar preco,
                                // anunciar, repassar). Cor a partir de 60 e 120 dias.
                                const dias = Math.floor((Date.now() - new Date(car.created_at)) / 86400000);
                                const cor = dias >= 120 ? '#dc2626' : dias >= 60 ? '#d97706' : 'var(--color-text-muted)';
                                return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: cor, marginTop: 4 }}>
                                        <CalendarDays size={13} />
                                        <span>
                                            entrou {new Date(car.created_at).toLocaleDateString('pt-BR')}
                                            {' · '}
                                            <strong>{dias} {dias === 1 ? 'dia' : 'dias'} em estoque</strong>
                                        </span>
                                    </div>
                                );
                            })()}
                            <div className="inv-card-actions">
                                <button className="inv-action-btn sell" onClick={() => setSellCarObj(car)} title="Finalizar venda">
                                    <ShoppingCart size={16} /> Vendido
                                </button>
                                <button className="inv-action-btn" onClick={() => setViewCar(car)} title="Ver detalhes"><Eye size={16} /></button>
                                <button className="inv-action-btn" onClick={() => setEditCar(car)} title="Editar"><Pencil size={16} /></button>
                                <button
                                    className="inv-action-btn"
                                    onClick={() => handleDelete(car.id)}
                                    title="Excluir veículo"
                                    style={{ color: '#ef4444' }}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '5rem 2rem', background: 'var(--card-bg)', borderRadius: '16px', border: '1px dashed var(--border)' }}>
                        <Package size={56} style={{ color: '#94a3b8', marginBottom: '1.5rem', opacity: 0.8 }} />
                        <h3 style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.25rem', color: '#1e293b' }}>Nenhum veículo encontrado</h3>
                        <p className="text-muted" style={{ maxWidth: '400px', margin: '0 auto' }}>Tente ajustar os filtros de busca ou clique em "Novo Veículo" para adicionar um ao seu pátio.</p>
                    </div>
                )}
            </div>

            {showConsulta && (
                <ConsultaPlacaModal
                    onClose={() => setShowConsulta(false)}
                    onAdicionar={(dados) => { setShowConsulta(false); setPreenchido(dados); setShowAddModal(true); }}
                />
            )}
            {showAddModal && (
                <CarFormModal
                    inicial={preenchido}
                    onClose={() => { setShowAddModal(false); setPreenchido(null); }}
                    onSave={handleAddCar}
                />
            )}
            {editCar && <CarFormModal car={editCar} isEdit onClose={() => setEditCar(null)} onSave={handleEditCar} />}
            {sellCarObj && <SellModal car={sellCarObj} onClose={() => setSellCarObj(null)} onConfirm={handleSell} />}
            {contratoDe && (
                <ContratoModal
                    carro={contratoDe.carro}
                    venda={contratoDe.venda}
                    onClose={() => setContratoDe(null)}
                />
            )}
            {viewCar && <DetailDrawer car={viewCar} onClose={() => setViewCar(null)} />}
            {confirmDeleteId && (
                <ConfirmModal
                    message="Tem certeza que deseja excluir este veículo do estoque? Essa ação não pode ser desfeita."
                    onConfirm={confirmDelete}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
            {matchModalData && (
                <MatchFoundModal data={matchModalData} onClose={() => setMatchModalData(null)} />
            )}
        </div>
    );
};

export default Inventory;
