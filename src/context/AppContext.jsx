import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { kmInteiro } from '../lib/numero.js';

const AppContext = createContext();

// Funções utilitárias para datas
export const getTodayStr = () => new Date().toISOString().split('T')[0];
export const formatDateStr = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
};

const EMPTY_DATA = {
  company: {
    name: 'Minha Concessionária',
    address: '',
    phone: '',
    whatsapp: ''
  },
  agendaConfig: {
    days: { Seg: true, Ter: true, Qua: true, Qui: true, Sex: true, Sab: false, Dom: false },
    startTime: '09:00',
    endTime: '18:00',
    duration: '60',
    interval: '15'
  },
  inventory: [],
  soldCars: [],
  leads: [],
  appointments: []
};

// ========== Tradução de erros Supabase ==========
const translateAuthError = (error) => {
  const msg = error?.message || '';
  if (msg.includes('Invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('Email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (msg.includes('User already registered')) return 'Este e-mail já está cadastrado.';
  if (msg.includes('Password should be at least')) return 'A senha deve ter pelo menos 6 caracteres.';
  if (msg.includes('Unable to validate email')) return 'E-mail inválido.';
  if (msg.includes('Signup requires a valid password')) return 'Informe uma senha válida.';
  return 'Ocorreu um erro. Tente novamente.';
};

// ========== Status Mapping: UI (pt-BR) <-> DB (en) ==========
const STATUS_UI_TO_DB = {
  agendado: 'scheduled',
  confirmado: 'confirmed',
  realizado: 'completed',
  cancelado: 'cancelled',
  ausente: 'no_show'
};
const STATUS_DB_TO_UI = Object.fromEntries(Object.entries(STATUS_UI_TO_DB).map(([k, v]) => [v, k]));

export const AppProvider = ({ children }) => {
  // ========== Auth State (Supabase) ==========
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // ========== Local Data State (leads, etc) ==========
  const [data, setData] = useState(EMPTY_DATA);
  const [inventory, setInventory] = useState([]);
  const [soldCars, setSoldCars] = useState([]);

  // ========== Supabase State: Leads, Appointments & Company Settings ==========
  const [leads, setLeads] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [companySettings, setCompanySettings] = useState(null);
  const [vehicleInterests, setVehicleInterests] = useState([]);
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [financialEntries, setFinancialEntries] = useState([]);
  const [recurringExpenses, setRecurringExpenses] = useState([]);

  const [toasts, setToasts] = useState([]);

  // Ref para evitar fetch duplicado de perfil
  const profileFetchedRef = useRef(false);

  // ========== Derived State ==========
  const isAuthenticated = !!session;

  // Quem chega por link de "esqueci minha senha" tem sessao valida, mas NAO
  // pode simplesmente cair no CRM: ele veio justamente porque nao sabe a senha.
  // Este estado segura a pessoa numa tela de definir senha nova.
  const [precisaNovaSenha, setPrecisaNovaSenha] = useState(false);

  // Company: companySettings do Supabase tem prioridade, fallback para local
  const company = {
    name: companySettings?.company_name || profile?.company_name || data.company.name,
    address: companySettings?.address ?? data.company.address,
    phone: companySettings?.phone_number ?? data.company.phone,
    whatsapp: companySettings?.whatsapp_number ?? data.company.whatsapp
  };

  // agendaConfig: companySettings do Supabase tem prioridade, fallback para local
  const agendaConfig = companySettings ? {
    days: (() => {
      const activeDays = (companySettings.working_days || 'Seg,Ter,Qua,Qui,Sex').split(',');
      return { Seg: activeDays.includes('Seg'), Ter: activeDays.includes('Ter'), Qua: activeDays.includes('Qua'), Qui: activeDays.includes('Qui'), Sex: activeDays.includes('Sex'), Sab: activeDays.includes('Sab'), Dom: activeDays.includes('Dom') };
    })(),
    startTime: companySettings.business_hours_start || '09:00',
    endTime: companySettings.business_hours_end || '18:00',
    duration: String(companySettings.appointment_duration || 60),
    interval: String(companySettings.appointment_interval || 15)
  } : data.agendaConfig;

  // ========== Toast System ==========
  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ========== Data Persistence (Isolated per User) ==========
  useEffect(() => {
    if (user?.id) {
      const userKey = `amplyData_${user.id}`;
      const saved = localStorage.getItem(userKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Garantir que todas as chaves existam mesmo se o cache antigo estiver incompleto
          setData({
            ...EMPTY_DATA,
            ...parsed,
            company: parsed.company ? { ...EMPTY_DATA.company, ...parsed.company } : EMPTY_DATA.company,
            agendaConfig: parsed.agendaConfig ? { ...EMPTY_DATA.agendaConfig, ...parsed.agendaConfig } : EMPTY_DATA.agendaConfig
          });
        } catch (e) {
          console.error("Erro processando dados do LS", e);
          setData(EMPTY_DATA);
        }
      } else {
        // Usuário novo, nenhum dado local ainda
        setData(EMPTY_DATA);
      }
    } else {
      // Usuário deslogado
      setData(EMPTY_DATA);
    }
  }, [user?.id]);

  useEffect(() => {
    // Só salva se houver um usuário logado
    if (user?.id && data) {
      const userKey = `amplyData_${user.id}`;
      localStorage.setItem(userKey, JSON.stringify(data));
    }
  }, [data, user?.id]);

  // ========== Fetch Profile from Supabase ==========
  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Erro ao buscar perfil:', error);
        return null;
      }

      setProfile(profileData);

      // Sincronizar company_name do Supabase com estado local
      if (profileData?.company_name) {
        setData(prev => ({
          ...prev,
          company: { ...prev.company, name: profileData.company_name }
        }));
      }

      return profileData;
    } catch (err) {
      console.error('Erro inesperado ao buscar perfil:', err);
      return null;
    }
  }, []);

  // ========== Update Profile in Supabase ==========
  const updateProfile = useCallback(async (updates) => {
    if (!user?.id) return { error: 'Usuário não autenticado' };

    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) {
        console.error('Erro ao atualizar perfil:', error);
        addToast('Erro ao salvar perfil no servidor.', 'error');
        return { error };
      }

      // Atualizar estado local do perfil
      setProfile(prev => prev ? { ...prev, ...updates } : updates);
      return { error: null };
    } catch (err) {
      console.error('Erro inesperado ao atualizar perfil:', err);
      return { error: err };
    }
  }, [user, addToast]);

  // ========== Fetch Inventory from Supabase ==========
  const fetchInventory = useCallback(async (userId) => {
    try {
      const { data: cars, error } = await supabase
        .from('cars')
        .select('*, car_images(image_url, sort_order)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erro ao buscar veículos:', error);
        return;
      }

      const mappedCars = cars.map(c => {
        const sortedImages = (c.car_images || []).sort((a, b) => a.sort_order - b.sort_order);
        return {
          ...c,
          images: sortedImages.map(img => img.image_url),
          km: c.mileage || 0,
          status: c.status === 'sold' ? 'vendido' : 'disponivel',
          // O status do banco tem quatro valores e este mapa achata pra dois.
          // `status_real` preserva o original, que é o que distingue o carro
          // recém-chegado da troca ('incoming') de um pronto pra vender.
          status_real: c.status,
          description: c.description || '',
        };
      });

      const available = mappedCars.filter(c => c.status !== 'vendido');
      const sold = mappedCars.filter(c => c.status === 'vendido');

      setInventory(available);
      setSoldCars(sold);
    } catch (err) {
      console.error('Erro inesperado ao buscar estoque:', err);
    }
  }, []);

  // ========== Fetch Leads from Supabase ==========
  const fetchLeads = useCallback(async (userId) => {
    try {
      const { data: dbLeads, error } = await supabase
        .from('leads')
        // O `!car_id` NAO e enfeite: desde que `sold_car_id` passou a apontar
        // pra `cars` tambem (063), existem DUAS chaves estrangeiras de leads
        // pra cars e o PostgREST recusa o embed ambiguo — a busca inteira
        // falhava e a lista de leads vinha vazia. Dica por COLUNA em vez do
        // nome da constraint, que depende de como o Postgres batizou.
        .select(`
          *,
          cars!car_id ( brand, model, version )
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[LEADS] Erro ao buscar leads:', error);
        return;
      }

      const mapped = (dbLeads || []).map(l => ({
        id: l.id,
        name: l.name,
        phone: l.phone || '',
        email: l.email || '',
        car: l.cars ? `${l.cars.brand} ${l.cars.model} ${l.cars.version}` : 'Busca genérica',
        status: l.status,
        source: l.source || 'manual',
        client_type: l.client_type || null,
        notes: l.notes || '',
        date: l.created_at,
        sold_car_id: l.sold_car_id || null,
        sold_at: l.sold_at || null,
        birth_date: l.birth_date || '',
        city: 'Não informada',
        family_info: l.family_info || '',
        occupation: l.occupation || '',
        recreation_info: l.recreation_info || '',
        financial_info: l.financial_info || '',
        trade_in_model: l.trade_in_model || '',
        trade_in_year: l.trade_in_year || '',
        trade_in_km: l.trade_in_km || '',
        trade_in_ownership_time: l.trade_in_ownership_time || '',
        trade_in_owner_rating: l.trade_in_owner_rating || '',
        trade_in_payment_preference: l.trade_in_payment_preference || '',
        trade_in_difference_payment: l.trade_in_difference_payment || '',
        trade_in_extra_info: l.trade_in_extra_info || '',
        avatar: l.name.charAt(0).toUpperCase()
      }));

      setLeads(mapped);
    } catch (err) {
      console.error('[LEADS] Erro inesperado:', err);
    }
  }, []);

  // ========== Fetch Appointments from Supabase ==========
  const fetchAppointments = useCallback(async (userId) => {
    try {
      const { data: appts, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', userId)
        .order('appointment_date', { ascending: true })
        .order('appointment_time', { ascending: true });

      if (error) {
        console.error('[AGENDA] Erro ao buscar agendamentos:', error);
        return;
      }

      // Mapeia DB -> UI format
      const mapped = (appts || []).map(a => ({
        id: a.id,
        customer: a.customer_name,
        phone: a.customer_phone || '',
        email: a.customer_email || '',
        car: a.car_id || '',
        date: a.appointment_date,
        time: a.appointment_time,
        notes: a.notes || '',
        status: STATUS_DB_TO_UI[a.status] || 'agendado',
        car_id: a.car_id
      }));

      setAppointments(mapped);
    } catch (err) {
      console.error('[AGENDA] Erro inesperado:', err);
    }
  }, []);

  // ========== Fetch Vehicle Interests (Lista de Espera) ==========
  const fetchVehicleInterests = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('vehicle_interests')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('[INTERESTS] Erro ao carregar:', error);
        return;
      }
      setVehicleInterests(data ?? []);
    } catch (err) {
      console.error('[INTERESTS] Erro inesperado:', err);
    }
  }, []);

  // ========== Fetch Message Templates ==========
  const fetchMessageTemplates = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) { console.error('[TEMPLATES] Erro ao carregar:', error); return; }
      setMessageTemplates(data ?? []);
    } catch (err) {
      console.error('[TEMPLATES] Erro inesperado:', err);
    }
  }, []);

  // ========== Fetch Campaigns ==========
  const fetchCampaigns = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*, template:template_id(display_name, category, meta_template_name)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) { console.error('[CAMPAIGNS] Erro ao carregar:', error); return; }
      setCampaigns(data ?? []);
    } catch (err) {
      console.error('[CAMPAIGNS] Erro inesperado:', err);
    }
  }, []);

  // ========== Fetch Company Settings from Supabase ==========
  const fetchCompanySettings = useCallback(async (userId) => {
    try {
      const { data: settings, error } = await supabase
        .from('company_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        // Nenhum registro encontrado — criar configuração padrão
        console.log('[SETTINGS] Criando configuração inicial...');
        const { data: newSettings, error: insertError } = await supabase
          .from('company_settings')
          .insert([{ user_id: userId }])
          .select()
          .single();

        if (insertError) {
          console.error('[SETTINGS] Erro ao criar configuração:', insertError);
          return;
        }
        setCompanySettings(newSettings);
        return;
      }

      if (error) {
        console.error('[SETTINGS] Erro ao buscar configuração:', error);
        return;
      }

      setCompanySettings(settings);
    } catch (err) {
      console.error('[SETTINGS] Erro inesperado:', err);
    }
  }, []);

  // Re-busca company_settings sob demanda (usado pela tela de Configurações após
  // salvar uma seção, pra manter o estado do contexto fresco — a tela hidrata dele).
  const refreshCompanySettings = useCallback(async () => {
    if (user?.id) await fetchCompanySettings(user.id);
  }, [user?.id, fetchCompanySettings]);

  // ========== Auth State Listener ==========
  const subscriptionRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    // Usar onAuthStateChange como mecanismo ÚNICO (recomendação Supabase v2)
    // INITIAL_SESSION é o primeiro evento disparado e contém a sessão restaurada
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;
        console.log('[AUTH] Event:', event, '| session:', !!newSession);

        if (event === 'INITIAL_SESSION') {
          // Sessão restaurada do localStorage
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (newSession?.user) {
            const uid = newSession.user.id;
            const loadAll = (async () => {
              try {
                // Chamadas sequenciais para evitar conflito de lock do auth token
                await fetchProfile(uid);
                await fetchInventory(uid);
                await fetchLeads(uid);
                await fetchAppointments(uid);
                await fetchCompanySettings(uid);
                await fetchVehicleInterests(uid);
                await fetchMessageTemplates(uid);
                await fetchCampaigns(uid);
                await fetchFinancialEntries(uid);
                await fetchRecurringExpenses(uid);
              } catch (err) {
                console.error('[AUTH] Erro ao carregar dados iniciais:', err);
              }
            })();
            // Timeout: não deixa o spinner GLOBAL preso se alguma query pendurar (conexão morta).
            await Promise.race([loadAll, new Promise((r) => setTimeout(r, 8000))]);
          }
          if (mounted) setIsLoading(false);

        } else if (event === 'SIGNED_IN' && newSession?.user) {
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (!profileFetchedRef.current) {
            profileFetchedRef.current = true;
            const uid = newSession.user.id;
            const loadAll = (async () => {
              try {
                // Chamadas sequenciais para evitar conflito de lock do auth token
                await fetchProfile(uid);
                await fetchInventory(uid);
                await fetchLeads(uid);
                await fetchAppointments(uid);
                await fetchCompanySettings(uid);
                await fetchVehicleInterests(uid);
                await fetchMessageTemplates(uid);
                await fetchCampaigns(uid);
                await fetchFinancialEntries(uid);
                await fetchRecurringExpenses(uid);
              } catch (err) {
                console.error('[AUTH] Erro ao carregar dados pós-login:', err);
              }
            })();
            await Promise.race([loadAll, new Promise((r) => setTimeout(r, 8000))]);
          }
          if (mounted) setIsLoading(false);

        } else if (event === 'PASSWORD_RECOVERY') {
          // Disparado quando o link do e-mail de recuperacao e consumido.
          setSession(newSession);
          setUser(newSession?.user ?? null);
          setPrecisaNovaSenha(true);
          if (mounted) setIsLoading(false);

        } else if (event === 'SIGNED_OUT') {
          console.log('[AUTH] Limpando estado local...');
          setSession(null);
          setUser(null);
          setProfile(null);
          setInventory([]);
          setSoldCars([]);
          setFinancialEntries([]);
          setRecurringExpenses([]);
          setLeads([]);
          setAppointments([]);
          setCompanySettings(null);
          setVehicleInterests([]);
          setMessageTemplates([]);
          setCampaigns([]);
          setData(EMPTY_DATA);
          profileFetchedRef.current = false;
          if (mounted) setIsLoading(false);

        } else if (event === 'TOKEN_REFRESHED') {
          setSession(newSession);
          setUser(newSession?.user ?? null);
        }
      }
    );

    subscriptionRef.current = subscription;

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, fetchInventory, fetchAppointments, fetchCompanySettings, fetchVehicleInterests, fetchMessageTemplates, fetchCampaigns]);

  // ========== Auth Actions (Supabase) ==========
  const login = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    addToast('Login realizado com sucesso!', 'success');
    return { success: true };
  };

  const signup = async (email, password, fullName) => {
    const { data: authData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) {
      return { success: false, error: translateAuthError(error) };
    }

    // Se autoconfirm está ativo, o usuário já loga direto
    if (authData.session) {
      addToast('Conta criada com sucesso! Bem-vindo.', 'success');
      return { success: true };
    }

    // Se precisa confirmar email
    addToast('Conta criada! Verifique seu e-mail.', 'info');
    return { success: true, needsConfirmation: true };
  };

  // Dispara o e-mail de "esqueci minha senha".
  //
  // A resposta NAO diz se o e-mail existe, de proposito: responder "essa conta
  // nao existe" transforma a tela de recuperacao num verificador de cadastro,
  // e alguem com uma lista de e-mails descobre quais sao clientes do Amply.
  const recuperarSenha = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) return { success: false, error: translateAuthError(error) };
    return { success: true };
  };

  // Confirma o cadastro pelo CODIGO de 6 digitos que veio no e-mail.
  //
  // O link continua funcionando, mas o codigo e o caminho principal por um
  // motivo pratico: o lojista le o e-mail no celular e costuma estar cadastrando
  // no computador. Com link, ele confirma no aparelho errado e a tela onde ele
  // esta continua parada esperando. Com codigo, ele digita onde ja esta.
  //
  // O `type: 'signup'` e o que diferencia do codigo de recuperacao de senha.
  const confirmarCadastro = async (email, codigo) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: String(codigo).replace(/\D/g, ''),
      type: 'signup',
    });
    if (error) return { success: false, error: translateAuthError(error) };
    // Deu certo: o verifyOtp ja cria a sessao e o onAuthStateChange leva pro CRM.
    return { success: true };
  };

  // Reenvia a confirmacao de cadastro. Existe porque e-mail se perde: cai no
  // spam, o cliente apaga sem ver, digita errado e corrige depois.
  const reenviarConfirmacao = async (email) => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    if (error) return { success: false, error: translateAuthError(error) };
    return { success: true };
  };

  // Grava a senha nova de quem veio pelo link de recuperacao.
  const definirNovaSenha = async (senha) => {
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) return { success: false, error: translateAuthError(error) };
    setPrecisaNovaSenha(false);
    return { success: true };
  };

  const logout = useCallback(async () => {
    console.log('[LOGOUT] Iniciando logout...');

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('[LOGOUT] Erro no signOut:', error);
      }
      // O onAuthStateChange vai disparar SIGNED_OUT e limpar o estado
    } catch (err) {
      console.error('[LOGOUT] Exception no signOut:', err);
    }

    // Fallback: Se o onAuthStateChange não disparar, limpamos manualmente
    // Aguarda um momento para dar chance ao evento SIGNED_OUT
    setTimeout(() => {
      // Se ainda está autenticado, força limpeza manual
      setSession(prev => {
        if (prev !== null) {
          console.log('[LOGOUT] Fallback: limpando estado manualmente');
          setUser(null);
          setProfile(null);
          setInventory([]);
          setSoldCars([]);
          setAppointments([]);
          setCompanySettings(null);
          setData(EMPTY_DATA);
          profileFetchedRef.current = false;
          return null;
        }
        return prev;
      });
    }, 500);
  }, []);

  // ========== Actions - Regras de Storage de Imagens ==========
  const syncCarImages = async (carId, images) => {
    if (!user?.id) return [];

    if (!images || images.length === 0) {
      // Limpa todas as imagens do banco e storage
      const { data: existingImages } = await supabase.from('car_images').select('file_path').eq('car_id', carId);
      if (existingImages?.length > 0) {
        const paths = existingImages.filter(img => img.file_path).map(img => img.file_path);
        if (paths.length > 0) await supabase.storage.from('car-images').remove(paths);
      }
      await supabase.from('car_images').delete().eq('car_id', carId);
      return [];
    }

    // Enforce 8-image limit
    const safeImages = images.slice(0, 8);

    // 1. Busca imagens atuais no DB
    const { data: currentDbImages } = await supabase.from('car_images').select('*').eq('car_id', carId);
    const existingDbImages = currentDbImages || [];

    // URLs das imagens que já existem na nuvem e devem ser MANTIDAS
    const keptUrls = safeImages.filter(img => !img.file).map(img => img.preview);

    // Deleta do Storage os arquivos que foram removidos pelo usuário
    const imagesToDelete = existingDbImages.filter(dbImg =>
      dbImg.file_path && !keptUrls.includes(dbImg.image_url)
    );
    if (imagesToDelete.length > 0) {
      const pathsToRemove = imagesToDelete.map(img => img.file_path);
      await supabase.storage.from('car-images').remove(pathsToRemove);
    }

    // Deleta registros antigos do DB para reconstruir com nova ordem
    await supabase.from('car_images').delete().eq('car_id', carId);

    // 2. Upload novos + reconstrução de registros existentes
    const newRecords = [];
    for (let i = 0; i < safeImages.length; i++) {
      const item = safeImages[i];

      if (!item.file) {
        // Imagem já existente na nuvem — reinsere com file_path preservado
        const matchedOld = existingDbImages.find(old => old.image_url === item.preview);
        newRecords.push({
          car_id: carId,
          user_id: user.id,
          image_url: item.preview,
          file_path: matchedOld?.file_path || '',
          sort_order: i
        });
      } else {
        // Novo arquivo — upload para storage
        try {
          const file = item.file;
          const fileExt = file.name.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
          const filePath = `${user.id}/${carId}/${fileName}`;

          const { error: uploadError } = await supabase.storage
            .from('car-images')
            .upload(filePath, file);

          if (uploadError) {
            console.error(`[IMAGES] Upload falhou para ${file.name}:`, uploadError);
            continue; // Pula este arquivo, não aborta os demais
          }

          const { data: publicUrlData } = supabase.storage
            .from('car-images')
            .getPublicUrl(filePath);

          newRecords.push({
            car_id: carId,
            user_id: user.id,
            image_url: publicUrlData.publicUrl,
            file_path: filePath,
            sort_order: i
          });
        } catch (err) {
          console.error(`[IMAGES] Erro inesperado no upload:`, err);
          continue;
        }
      }
    }

    // 3. Insere registros ordenados no banco
    if (newRecords.length > 0) {
      const { error: insertError } = await supabase.from('car_images').insert(newRecords);
      if (insertError) console.error('[IMAGES] Erro ao inserir registros:', insertError);
    }

    return newRecords.sort((a, b) => a.sort_order - b.sort_order).map(r => r.image_url);
  };

  // Upload de uma única mídia (foto de specs ou vídeo) → retorna URL pública.
  // media: { url } (manter existente) | { file } (novo upload) | null (remover/vazio)
  const uploadCarMedia = async (media, bucket) => {
    if (!media) return null;
    if (media.url) return media.url;            // já está na nuvem — mantém
    if (media.file) {
      const ext  = (media.file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(path, media.file, { contentType: media.file.type, upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    }
    return null;
  };

  // ========== Actions - Estoque ==========
  const addInventoryCar = async (car) => {
    console.log('[INVENTORY] addInventoryCar chamado. user.id:', user?.id, 'car:', car?.brand, car?.model);
    if (!user?.id) {
      console.error('[INVENTORY] Abortado: user.id é null/undefined');
      addToast('Erro: sessão expirada. Faça login novamente.', 'error');
      return;
    }
    try {
      // Upload das mídias do bot (foto de specs → car-images, vídeo → car-videos)
      const specsImageUrl = await uploadCarMedia(car.specsImage, 'car-images');
      const videoUrl      = await uploadCarMedia(car.video, 'car-videos');

      const insertData = {
        user_id: user.id,
        brand: car.brand,
        model: car.model,
        version: car.version || '',
        year: Number(car.year),
        price: Number(car.price),
        mileage: kmInteiro(car.km) ?? 0,
        transmission: car.transmission || 'Automático',
        fuel: car.fuel || 'Flex',
        color: car.color || '',
        vehicle_type: car.vehicle_type || 'carro',
        description: car.description || null,
        // Documento do veiculo. Sem estes tres o contrato de venda sai com
        // linha em branco justamente onde ele identifica o bem.
        purchase_price: car.purchase_price ? Number(car.purchase_price) : null,
        // Ficha de compra (migration 082). Privada: o bot e o feed selecionam
        // colunas por lista explícita, então nada daqui chega ao cliente.
        purchase_date: car.purchase_date || null,
        purchase_from: car.purchase_from || null,
        purchase_phone: car.purchase_phone || null,
        purchase_financed: car.purchase_financed === true,
        purchase_notes: car.purchase_notes || null,
        plate: car.plate || null,
        chassi: car.chassi || null,
        renavam: car.renavam || null,
        model_year: car.model_year ? Number(car.model_year) : null,
        specs_image_url: specsImageUrl,
        video_url: videoUrl,
        status: 'available'
      };
      console.log('[INVENTORY] Inserindo no Supabase:', insertData);

      const { data: newCar, error } = await supabase
        .from('cars')
        .insert([insertData])
        .select()
        .single();

      if (error) {
        console.error('[INVENTORY] Erro do Supabase ao inserir:', error);
        throw error;
      }

      console.log('[INVENTORY] Veículo criado:', newCar.id);

      // Compra vira despesa no caixa E no custo do carro. Sem isto o lojista
      // teria que lancar a mao o numero que acabou de digitar no cadastro.
      if (Number(car.purchase_price) > 0) {
        await addFinancialEntry({
          car_id: newCar.id,
          tipo: 'despesa',
          categoria: 'Compra de veículos',
          valor: Number(car.purchase_price),
          descricao: `${newCar.brand ?? ''} ${newCar.model ?? ''}`.trim(),
          origem: 'automatico',
          ref: `compra:${newCar.id}`,
        });
      }

      // Chama a sincronização das imagens
      const finalImageUrls = await syncCarImages(newCar.id, car.images || []);

      const savedCar = { ...newCar, images: finalImageUrls, km: newCar.mileage, status: 'disponivel' };
      setInventory(prev => [savedCar, ...prev]);
      addToast('Veículo adicionado ao estoque com sucesso.', 'success');
      return savedCar;
    } catch (error) {
      console.error('[INVENTORY] Erro ao adicionar:', error);
      addToast('Erro ao adicionar veículo.', 'error');
      throw error; // re-lança para o modal manter-se aberto
    }
  };

  const updateInventoryCar = async (id, updates) => {
    if (!user?.id) return;
    try {
      const dbUpdates = { ...updates };
      // Remove campos que não são colunas da tabela cars
      delete dbUpdates.images;
      delete dbUpdates.image;
      delete dbUpdates.car_images;
      delete dbUpdates.specsImage;
      delete dbUpdates.video;
      // `status_real` é derivado na leitura, não é coluna. O formulário faz
      // `...car`, então tudo que a gente acrescenta ao objeto mapeado viaja de
      // volta no update — e uma coluna inexistente derruba a gravação INTEIRA,
      // não só o campo dela. Foi assim que editar veículo parou de salvar.
      delete dbUpdates.status_real;

      // Resolve mídias do bot (mantém URL existente, sobe arquivo novo, ou null se removida)
      dbUpdates.specs_image_url = await uploadCarMedia(updates.specsImage, 'car-images');
      dbUpdates.video_url       = await uploadCarMedia(updates.video, 'car-videos');

      if (dbUpdates.km !== undefined) {
        dbUpdates.mileage = kmInteiro(dbUpdates.km) ?? 0;
        delete dbUpdates.km;
      }
      if (dbUpdates.year !== undefined) dbUpdates.year = Number(dbUpdates.year);
      // Vazio precisa virar null, nao 0: ano do modelo em branco nao e ano zero.
      if (dbUpdates.purchase_price !== undefined) {
        dbUpdates.purchase_price = dbUpdates.purchase_price ? Number(dbUpdates.purchase_price) : null;
      }
      if (dbUpdates.model_year !== undefined) {
        dbUpdates.model_year = dbUpdates.model_year ? Number(dbUpdates.model_year) : null;
      }
      if (dbUpdates.price !== undefined) dbUpdates.price = Number(dbUpdates.price);
      if (dbUpdates.status === 'disponivel') dbUpdates.status = 'available';
      if (dbUpdates.status === 'vendido') dbUpdates.status = 'sold';

      // Carro que veio da troca sai de 'incoming' no momento em que ganha
      // preço. Precificar É a liberação: enquanto não tem valor de venda, ele
      // fica fora do bot e do feed. Fazer disso um botão separado só criaria
      // um passo que alguém esqueceria, e o carro ficaria invisível no pátio.
      const atual = inventory.find(c => c.id === id);
      if (atual?.status_real === 'incoming'
          && dbUpdates.status === undefined
          && Number(dbUpdates.price) > 0) {
        dbUpdates.status = 'available';
      }

      const { data: updatedCar, error } = await supabase
        .from('cars')
        .update(dbUpdates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
        
      if (error) throw error;

      const finalImageUrls = await syncCarImages(id, updates.images || []);

      const savedCar = { ...updatedCar, images: finalImageUrls, km: updatedCar.mileage };
      setInventory(prev => prev.map(c => c.id === id ? savedCar : c));
      addToast('Informações do veículo atualizadas.', 'success');
      return savedCar;
    } catch (error) {
      console.error('Erro ao atualizar', error);
      addToast('Erro ao atualizar veículo.', 'error');
      throw error; // re-lança para o modal manter-se aberto
    }
  };

  const removeInventoryCar = async (id) => {
    if (!user?.id) return;
    try {
      const { data: dbImages } = await supabase.from('car_images').select('file_path').eq('car_id', id);
      if (dbImages && dbImages.length > 0) {
         const pathsToRemove = dbImages.filter(img => img.file_path).map(img => img.file_path);
         if(pathsToRemove.length > 0) {
             await supabase.storage.from('car-images').remove(pathsToRemove);
         }
      }

      const { error } = await supabase
        .from('cars')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      // Tira das duas listas: a mesma função remove carro do estoque e carro
      // vendido, e filtrar só o estoque deixaria a venda excluída visível até
      // alguém recarregar a página.
      setInventory(prev => prev.filter(c => c.id !== id));
      setSoldCars(prev => prev.filter(c => c.id !== id));
      addToast('Veículo removido.', 'info');
    } catch (error) {
      console.error('Erro ao remover', error);
      addToast('Erro ao remover veículo.', 'error');
    }
  };

  // ========== Financeiro ==========

  const fetchFinancialEntries = useCallback(async (userId) => {
    const { data: rows, error } = await supabase
      .from('financial_entries')
      .select('*')
      .eq('user_id', userId)
      .order('data', { ascending: false });
    if (error) {
      console.error('[FIN] erro ao buscar lancamentos:', error.message);
      return;
    }
    setFinancialEntries(rows ?? []);
  }, []);

  const addFinancialEntry = async (entrada) => {
    if (!user?.id) return null;
    const linha = {
      user_id: user.id,
      car_id: entrada.car_id || null,
      tipo: entrada.tipo,
      categoria: String(entrada.categoria || '').trim(),
      valor: Number(entrada.valor) || 0,
      descricao: entrada.descricao || null,
      data: entrada.data || new Date().toISOString().slice(0, 10),
      origem: entrada.origem || 'manual',
      ref: entrada.ref || null,
    };
    const { data: nova, error } = await supabase
      .from('financial_entries').insert([linha]).select().single();

    if (error) {
      // Conflito de `ref` significa que o lancamento automatico ja existe. Nao e
      // erro: e a idempotencia funcionando (vender, desfazer e vender de novo
      // nao pode gerar dois lancamentos).
      if (error.code === '23505') return null;
      console.error('[FIN] erro ao lancar:', error.message);
      addToast('Nao consegui salvar o lancamento.', 'error');
      return null;
    }
    setFinancialEntries(prev => [nova, ...prev]);
    return nova;
  };

  // ── Despesas fixas ────────────────────────────────────────────────────────

  const fetchRecurringExpenses = useCallback(async (userId) => {
    const { data: rows, error } = await supabase
      .from('recurring_expenses')
      .select('*')
      .eq('user_id', userId)
      .order('dia', { ascending: true, nullsFirst: false });
    if (error) {
      console.error('[FIN] erro ao buscar despesas fixas:', error.message);
      return;
    }
    setRecurringExpenses(rows ?? []);
  }, []);

  const saveRecurringExpense = async (fixa) => {
    if (!user?.id) return null;
    const linha = {
      user_id: user.id,
      categoria: String(fixa.categoria || '').trim(),
      valor: Number(fixa.valor) || 0,
      descricao: fixa.descricao || null,
      dia: fixa.dia ? Number(fixa.dia) : null,
      ativo: fixa.ativo !== false,
    };
    const q = fixa.id
      ? supabase.from('recurring_expenses').update(linha).eq('id', fixa.id).eq('user_id', user.id)
      : supabase.from('recurring_expenses').insert([linha]);

    const { data: salva, error } = await q.select().single();
    if (error) {
      console.error('[FIN] erro ao salvar despesa fixa:', error.message);
      addToast('Nao consegui salvar a despesa fixa.', 'error');
      return null;
    }
    setRecurringExpenses(prev => fixa.id
      ? prev.map(f => (f.id === salva.id ? salva : f))
      : [...prev, salva]);
    return salva;
  };

  const removeRecurringExpense = async (id) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('recurring_expenses').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      addToast('Nao consegui excluir a despesa fixa.', 'error');
      return;
    }
    setRecurringExpenses(prev => prev.filter(f => f.id !== id));
  };

  /**
   * Lanca as fixas ativas de um mes (AAAA-MM).
   *
   * O `ref` "fixo:<id>:<mes>" e o que impede lancar o mesmo mes duas vezes —
   * inclusive dois usuarios da loja clicando junto, porque a unicidade esta no
   * banco e nao numa checagem daqui.
   */
  const lancarFixasDoMes = async (mes) => {
    const ativas = recurringExpenses.filter(f => f.ativo);
    if (!ativas.length) return 0;

    let criadas = 0;
    for (const f of ativas) {
      const dia = String(Math.min(Number(f.dia) || 1, 28)).padStart(2, '0');
      const nova = await addFinancialEntry({
        tipo: 'despesa',
        categoria: f.categoria,
        valor: f.valor,
        descricao: f.descricao,
        data: `${mes}-${dia}`,
        origem: 'manual',
        ref: `fixo:${f.id}:${mes}`,
      });
      if (nova) criadas += 1;
    }
    if (criadas) addToast(`${criadas} despesa(s) fixa(s) lancada(s).`, 'success');
    else addToast('As fixas deste mes ja estavam lancadas.', 'info');
    return criadas;
  };

  const removeFinancialEntry = async (id) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('financial_entries').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[FIN] erro ao excluir:', error.message);
      addToast('Nao consegui excluir o lancamento.', 'error');
      return;
    }
    setFinancialEntries(prev => prev.filter(l => l.id !== id));
  };

  // Dois telefones sao o mesmo numero? Compara DDD + 8 digitos finais.
  //
  // Nao da pra comparar string crua: o mesmo numero aparece como
  // "5515988372081", "(15) 98837-2081" e "15 8837-2081" dependendo de quem
  // digitou, e o nono digito entrou em epocas diferentes por regiao. Os 8
  // finais mais o DDD e o maior denominador comum confiavel.
  const mesmoTelefone = (a, b) => {
    const limpar = (v) => {
      let d = String(v ?? '').replace(/\D/g, '');
      if (d.length > 11) d = d.slice(-11);       // tira o 55 do pais
      if (d.length === 11) d = d.slice(0, 2) + d.slice(3); // tira o nono digito
      return d;                                   // sobra DDD + 8
    };
    const x = limpar(a), y = limpar(b);
    return x.length >= 10 && x === y;
  };

  const sellCar = async (inventoryId, salePrice, saleDate, sellerName, comprador = null, veiculo = null) => {
    if (!user?.id) return;
    try {
      const { data: updatedCar, error } = await supabase
        .from('cars')
        .update({
          status: 'sold',
          sold_price: Number(salePrice),
          sold_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
          sold_by: sellerName,
          // Dados do comprador so entram se vieram preenchidos: venda sem
          // contrato continua valida, e mandar null apagaria o que ja existisse.
          ...(comprador?.buyer_name ? {
            buyer_name: comprador.buyer_name,
            buyer_cpf: String(comprador.buyer_cpf ?? '').replace(/\D/g, '') || null,
            buyer_rg: comprador.buyer_rg || null,
            buyer_address: comprador.buyer_address || null,
            // Endereço em partes, além do texto corrido. O contrato usa a linha
            // inteira; a nota fiscal exige os pedaços separados, e a UF é o que
            // define a tributação da operação.
            buyer_numero: comprador.buyer_numero || null,
            buyer_bairro: comprador.buyer_bairro || null,
            buyer_municipio: comprador.buyer_municipio || null,
            buyer_uf: comprador.buyer_uf ? String(comprador.buyer_uf).toUpperCase() : null,
            buyer_cep: String(comprador.buyer_cep ?? '').replace(/\D/g, '') || null,
            buyer_phone: comprador.buyer_phone || null,
            payment_terms: comprador.payment_terms || null,
            buyer_email: comprador.buyer_email || null,
            // Fica no registro da venda além de ir pro lead: alguns contratos
            // pedem a data de nascimento na qualificação do comprador.
            buyer_birth_date: comprador.buyer_birth_date || null,
          } : {}),
          // Correcoes feitas na tela de venda entram no cadastro do carro. A
          // venda e o unico momento em que a loja tem o documento do veiculo na
          // mao; o que for completado ali fica, em vez de valer so pra aquele
          // contrato.
          ...(veiculo ? {
            version:    veiculo.version || null,
            model_year: veiculo.model_year ? Number(veiculo.model_year) : null,
            plate:      String(veiculo.plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
            renavam:    veiculo.renavam || null,
            chassi:     veiculo.chassi || null,
            color:      veiculo.color || null,
            mileage:    veiculo.km !== '' && veiculo.km != null ? kmInteiro(veiculo.km) : undefined,
          } : {}),
          // Troca entra separada do comprador: existe venda com troca e sem
          // dado de comprador preenchido, e o inverso tambem. Amarrar as duas
          // faria uma apagar a outra.
          ...(comprador?.trade_in_plate ? {
            trade_in_plate:  String(comprador.trade_in_plate).toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
            trade_in_brand:  comprador.trade_in_brand || null,
            trade_in_model:  comprador.trade_in_model || null,
            trade_in_year:   comprador.trade_in_year || null,
            trade_in_color:  comprador.trade_in_color || null,
            trade_in_chassi: comprador.trade_in_chassi || null,
            trade_in_renavam: comprador.trade_in_renavam || null,
            trade_in_km:     kmInteiro(comprador.trade_in_km),
            trade_in_value:  comprador.trade_in_value ? Number(comprador.trade_in_value) : null,
          } : {}),
        })
        .eq('id', inventoryId)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      // Preserva as imagens do carro que estava no estoque (o .select() do update não faz join com car_images)
      const inventoryCar = inventory.find(c => c.id === inventoryId);
      setInventory(prev => prev.filter(c => c.id !== inventoryId));
      setSoldCars(prev => [{
        ...updatedCar,
        km: updatedCar.mileage,
        status: 'vendido',
        images: inventoryCar?.images ?? [],
      }, ...prev]);
      // ── Lancamento da venda no financeiro ─────────────────────────────────
      // `ref` garante um por carro: vender, desfazer e vender de novo nao gera
      // dois. Marcado como automatico pra nao se confundir com o que o lojista
      // digitou — relatorio que conta a mesma venda duas vezes nao e aberto de
      // novo.
      await addFinancialEntry({
        car_id: inventoryId,
        tipo: 'receita',
        categoria: 'Venda de veículos',
        valor: salePrice,
        descricao: `${updatedCar.brand ?? ''} ${updatedCar.model ?? ''}`.trim(),
        data: (saleDate || new Date().toISOString()).slice(0, 10),
        origem: 'automatico',
        ref: `venda:${inventoryId}`,
      });

      // ── Liga o lead que comprou ────────────────────────────────────────────
      // Sem isto o lead fica parado em "atendimento" pra sempre e nao da pra
      // separar quem comprou de quem so olhou.
      //
      // So marca quando UM unico lead bate o telefone. Dois leads com o mesmo
      // numero e caso real (casal, pai e filho, o mesmo cliente cadastrado
      // duas vezes), e escolher um no chute marcaria a pessoa errada como
      // compradora. Nesse caso nao mexe em nada.
      const tel = comprador?.buyer_name ? comprador?.buyer_phone : null;
      const nascimento = comprador?.buyer_birth_date || null;
      if (tel) {
        const candidatos = leads.filter(l => mesmoTelefone(l.phone, tel) && l.status !== 'vendido');

        // Comprador que NUNCA foi lead — entrou na loja e comprou no mesmo dia.
        //
        // Sem isto ele não existe no CRM depois da venda: não aparece na base,
        // não entra em campanha, e a data de aniversário que a loja acabou de
        // coletar não serve pra nada. Justamente o cliente mais valioso, porque
        // já comprou.
        if (candidatos.length === 0 && !leads.some(l => mesmoTelefone(l.phone, tel))) {
          const { data: novoLead, error: erroNovo } = await supabase
            .from('leads')
            .insert({
              user_id: user.id,
              name: comprador.buyer_name,
              phone: tel,
              email: comprador.buyer_email || null,
              birth_date: nascimento,
              status: 'vendido',
              sold_car_id: inventoryId,
              sold_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
              source: 'venda',
              notes: 'Cadastrado automaticamente ao registrar a venda',
            })
            .select('*')
            .maybeSingle();

          if (erroNovo) {
            console.warn('[VENDA] nao consegui cadastrar o comprador como lead:', erroNovo.message);
          } else if (novoLead) {
            setLeads(prev => [{ ...novoLead, birth_date: novoLead.birth_date || '' }, ...prev]);
            addToast(`${comprador.buyer_name} cadastrado como cliente.`, 'success');
          }
        } else if (candidatos.length === 1) {
          const lead = candidatos[0];
          const { error: erroLead } = await supabase
            .from('leads')
            .update({
              status: 'vendido',
              sold_car_id: inventoryId,
              sold_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
              // Só preenche o aniversário se veio agora E o lead não tinha.
              // Sobrescrever com vazio apagaria uma data que alguém já digitou.
              ...(nascimento ? { birth_date: nascimento } : {}),
            })
            .eq('id', lead.id)
            .eq('user_id', user.id);

          if (erroLead) {
            // Nao derruba a venda: o carro ja foi vendido e isso e o que importa.
            console.warn('[VENDA] nao consegui marcar o lead:', erroLead.message);
          } else {
            setLeads(prev => prev.map(l => l.id === lead.id
              ? { ...l, status: 'vendido', sold_car_id: inventoryId, ...(nascimento ? { birth_date: nascimento } : {}) }
              : l));
            addToast('Lead ' + lead.name + ' marcado como comprador.', 'success');
          }
        } else if (candidatos.length > 1) {
          console.info('[VENDA] mais de um lead com este telefone; nenhum marcado');
        }
      }

      addToast('Venda registrada com sucesso! Analise o histórico.', 'success');
    } catch (error) {
      console.error('Erro ao vender', error);
      // A mensagem generica escondeu a causa por dois dias: o erro real era
      // 'invalid input syntax for type integer: "14.699"' e a tela so dizia
      // "Erro ao vender veiculo". Quem atende precisa conseguir ler o motivo
      // ou mandar print de algo util.
      addToast(`Erro ao vender veículo: ${error?.message ?? 'motivo desconhecido'}`, 'error');
    }
  };

  // ========== Actions - Lista de Espera (vehicle_interests) ==========
  const refreshVehicleInterests = useCallback(async () => {
    if (user?.id) await fetchVehicleInterests(user.id);
  }, [user?.id, fetchVehicleInterests]);

  const updateInterestStatus = async (interestId, newStatus) => {
    const { error } = await supabase
      .from('vehicle_interests')
      .update({ status: newStatus })
      .eq('id', interestId);
    if (error) {
      console.error('[INTERESTS] Erro ao atualizar status:', error);
      addToast('Erro ao atualizar interesse.', 'error');
      return false;
    }
    setVehicleInterests(prev => prev.map(i => i.id === interestId ? { ...i, status: newStatus } : i));
    return true;
  };

  // Cadastro manual na lista de espera.
  //
  // Ate agora so o bot criava interesse, o que deixava de fora o caso mais
  // comum de todos: o cliente que ligou, passou na loja ou falou com o vendedor
  // na rua. Esses ficavam num papel e a loja nao era avisada quando o carro
  // entrava.
  const addInterest = async (dados) => {
    if (!user?.id) return null;
    const telefone = String(dados.customer_phone ?? '').replace(/\D/g, '');
    if (!telefone || !String(dados.model ?? '').trim()) {
      addToast('Telefone e modelo sao obrigatorios.', 'error');
      return null;
    }
    const linha = {
      user_id: user.id,
      customer_phone: telefone,
      customer_name: dados.customer_name || null,
      brand: dados.brand || null,
      model: String(dados.model).trim(),
      year_min: dados.year_min ? Number(dados.year_min) : null,
      year_max: dados.year_max ? Number(dados.year_max) : null,
      km_max: dados.km_max ? Number(dados.km_max) : null,
      price_max: dados.price_max ? Number(dados.price_max) : null,
      vehicle_type: dados.vehicle_type || null,
      notes: dados.notes || null,
      status: 'active',
    };
    const { data: nova, error } = await supabase
      .from('vehicle_interests').insert([linha]).select().single();
    if (error) {
      console.error('[INTERESSE] erro ao cadastrar:', error.message);
      addToast('Nao consegui salvar na lista de espera.', 'error');
      return null;
    }
    setVehicleInterests(prev => [nova, ...prev]);
    addToast('Cliente adicionado a lista de espera.', 'success');
    return nova;
  };

  const deleteInterest = async (interestId) => {
    const { error } = await supabase
      .from('vehicle_interests')
      .delete()
      .eq('id', interestId);
    if (error) {
      console.error('[INTERESTS] Erro ao excluir:', error);
      addToast('Erro ao excluir interesse.', 'error');
      return false;
    }
    setVehicleInterests(prev => prev.filter(i => i.id !== interestId));
    return true;
  };

  // Aviso automático via template (edge function notify-waiting-list-match)
  const notifyWaitingListMatch = async (carId, interestIds, opts = {}) => {
    if (!carId || !interestIds?.length) return false;
    try {
      if (!opts.auto) addToast('Enviando avisos...', 'info');
      const { data, error } = await supabase.functions.invoke('notify-waiting-list-match', {
        body: { car_id: carId, interest_ids: interestIds, auto: !!opts.auto },
      });
      if (error || data?.error) {
        addToast(`Erro ao avisar: ${data?.error || error?.message || 'desconhecido'}`, 'error');
        return false;
      }
      if (user?.id) await fetchVehicleInterests(user.id);
      addToast(opts.auto
        ? `${data.sent} cliente(s) avisado(s) automaticamente sobre ${opts.carName || 'o carro'}${data.failed ? ` (${data.failed} falha)` : ''}.`
        : `${data.sent} aviso(s) enviado(s)${data.failed ? `, ${data.failed} falha(s)` : ''}.`, 'success');
      return true;
    } catch (e) {
      console.error('[INTERESTS] notify erro:', e);
      addToast('Erro ao enviar avisos.', 'error');
      return false;
    }
  };

  // ========== Actions - Message Templates ==========
  const refreshTemplates = useCallback(async () => {
    if (user?.id) await fetchMessageTemplates(user.id);
  }, [user?.id, fetchMessageTemplates]);

  // Gera nome técnico Meta a partir do nome amigável (lowercase, snake_case)
  const slugifyTemplateName = (name) =>
    String(name || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      .slice(0, 60) || `template_${Date.now()}`;

  const saveTemplate = async (tpl) => {
    if (!user?.id) return null;
    const payload = {
      user_id: user.id,
      meta_template_name: tpl.meta_template_name || slugifyTemplateName(tpl.display_name),
      display_name: tpl.display_name,
      category: tpl.category,
      language: tpl.language || 'pt_BR',
      header_type: tpl.header_type || null,
      header_content: tpl.header_content || null,
      body_text: tpl.body_text,
      body_variables: tpl.body_variables || [],
      footer_text: tpl.footer_text || null,
      buttons: tpl.buttons || [],
    };
    try {
      let result;
      if (tpl.id) {
        const { data, error } = await supabase
          .from('message_templates')
          .update({ ...payload, status: 'draft', rejection_reason: null })
          .eq('id', tpl.id).select().single();
        if (error) throw error;
        result = data;
        setMessageTemplates(prev => prev.map(t => t.id === data.id ? data : t));
      } else {
        const { data, error } = await supabase
          .from('message_templates')
          .insert(payload).select().single();
        if (error) throw error;
        result = data;
        setMessageTemplates(prev => [data, ...prev]);
      }
      addToast('Template salvo.', 'success');
      return result;
    } catch (error) {
      console.error('[TEMPLATES] Erro ao salvar:', error);
      addToast(error.message?.includes('duplicate') ? 'Já existe um template com esse nome técnico.' : 'Erro ao salvar template.', 'error');
      throw error;
    }
  };

  const deleteTemplate = async (id) => {
    const { error } = await supabase.from('message_templates').delete().eq('id', id);
    if (error) { console.error('[TEMPLATES] Erro ao excluir:', error); addToast('Erro ao excluir template.', 'error'); return false; }
    setMessageTemplates(prev => prev.filter(t => t.id !== id));
    return true;
  };

  // Submete o template para aprovação da Meta (edge function)
  const submitTemplate = async (id) => {
    try {
      const { data, error } = await supabase.functions.invoke('submit-template-to-meta', { body: { template_id: id } });
      if (error || data?.error) {
        const msg = data?.details ? JSON.stringify(data.details) : (data?.error || error?.message || 'Erro');
        addToast(`Meta recusou: ${msg}`.slice(0, 160), 'error');
        await refreshTemplates();
        return false;
      }
      addToast('Template enviado pra aprovação da Meta.', 'success');
      await refreshTemplates();
      return true;
    } catch (e) {
      console.error('[TEMPLATES] submit erro:', e);
      addToast('Erro ao enviar template.', 'error');
      return false;
    }
  };

  // Verifica status dos templates pendentes na Meta
  const checkTemplateStatus = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.functions.invoke('check-template-status', { body: { user_id: user.id } });
      if (error) { addToast('Erro ao verificar status.', 'error'); return; }
      await refreshTemplates();
      if (data?.updated > 0) addToast(`${data.updated} template(s) atualizado(s).`, 'success');
      else addToast('Nenhuma mudança de status ainda.', 'info');
    } catch (e) {
      console.error('[TEMPLATES] check erro:', e);
      addToast('Erro ao verificar status.', 'error');
    }
  };

  // ========== Actions - Campanhas ==========
  const refreshCampaigns = useCallback(async () => {
    if (user?.id) await fetchCampaigns(user.id);
  }, [user?.id, fetchCampaigns]);

  const createCampaign = async (camp) => {
    if (!user?.id) return null;
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .insert({
          user_id: user.id,
          template_id: camp.template_id,
          name: camp.name,
          audience_type: camp.audience_type,
          audience_filter: camp.audience_filter || {},
          template_variables: camp.template_variables || {},
          status: 'draft',
        })
        .select('*, template:template_id(display_name, category, meta_template_name)')
        .single();
      if (error) throw error;
      setCampaigns(prev => [data, ...prev]);
      return data;
    } catch (error) {
      console.error('[CAMPAIGNS] Erro ao criar:', error);
      addToast('Erro ao criar campanha.', 'error');
      throw error;
    }
  };

  const deleteCampaign = async (id) => {
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error) { console.error('[CAMPAIGNS] Erro ao excluir:', error); addToast('Erro ao excluir campanha.', 'error'); return false; }
    setCampaigns(prev => prev.filter(c => c.id !== id));
    return true;
  };

  // Dispara a campanha (edge function send-campaign)
  const sendCampaign = async (id) => {
    try {
      addToast('Disparando campanha... isso pode levar alguns minutos.', 'info');
      const { data, error } = await supabase.functions.invoke('send-campaign', { body: { campaign_id: id } });
      await refreshCampaigns();
      if (error || data?.error) {
        addToast(`Erro ao disparar: ${data?.error || error?.message || 'desconhecido'}`, 'error');
        return false;
      }
      addToast(`Disparo concluido: ${data.sent} enviada(s), ${data.failed} falha(s).`, 'success');
      return true;
    } catch (e) {
      console.error('[CAMPAIGNS] send erro:', e);
      addToast('Erro ao disparar campanha.', 'error');
      return false;
    }
  };

  const fetchCampaignSends = async (campaignId, signal) => {
    let query = supabase
      .from('campaign_sends')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) {
      if (!signal?.aborted) console.error('[CAMPAIGNS] Erro ao carregar envios:', error);
      return [];
    }
    return data ?? [];
  };

  // ========== Actions - Leads (Supabase) ==========
  const addLead = async (leadData) => {
    if (!user?.id) return;
    try {
      const insertData = {
        user_id: user.id,
        name: leadData.name,
        phone: leadData.phone || '',
        email: leadData.email || '',
        status: leadData.status || 'novo',
        notes: leadData.notes || '',
        car_id: leadData.car_id || null
      };

      const { data: newLead, error } = await supabase
        .from('leads')
        .insert([insertData])
        .select(`*, cars!car_id (brand, model, version)`)
        .single();

      if (error) throw error;

      const mapped = {
        id: newLead.id,
        name: newLead.name,
        phone: newLead.phone || '',
        email: newLead.email || '',
        car: newLead.cars ? `${newLead.cars.brand} ${newLead.cars.model} ${newLead.cars.version}` : 'Busca genérica',
        status: newLead.status,
        notes: newLead.notes || '',
        date: newLead.created_at,
        city: 'Não informada',
        avatar: newLead.name.charAt(0).toUpperCase()
      };

      setLeads(prev => [mapped, ...prev]);
      addToast('Lead cadastrado com sucesso.', 'success');
    } catch (error) {
      console.error('[LEADS] Erro ao cadastrar:', error);
      addToast('Erro ao cadastrar lead.', 'error');
    }
  };

  // Importação da base antiga. Vem em lote e pode ser grande (milhares), então
  // insere em blocos — um INSERT único com 2.000 linhas estoura limite de
  // payload e, se falhar, perde tudo. Em blocos, o que passou fica.
  const importLeads = async (contatos) => {
    if (!user?.id || !contatos?.length) return { inseridos: 0 };

    const BLOCO = 500;
    const inseridos = [];

    for (let i = 0; i < contatos.length; i += BLOCO) {
      const linhas = contatos.slice(i, i + BLOCO).map((c) => ({
        user_id: user.id,
        name: c.name,
        phone: c.phone,
        email: '',
        status: 'novo',
        source: 'importacao',
        // Sobrepõe a régua de 30 dias: o cadastro é de hoje, mas o cliente não.
        client_type: c.client_type ?? 'antigo',
        notes: 'Importado da base de clientes antigos',
      }));

      const { data, error } = await supabase.from('leads').insert(linhas).select('*');
      if (error) throw error;
      inseridos.push(...(data ?? []));
    }

    setLeads((prev) => [
      ...inseridos.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone || '',
        email: l.email || '',
        car: 'Busca genérica',
        status: l.status,
        source: l.source,
        client_type: l.client_type,
        notes: l.notes || '',
        date: l.created_at,
        city: 'Não informada',
        avatar: (l.name || '?').charAt(0).toUpperCase(),
      })),
      ...prev,
    ]);

    addToast(`${inseridos.length} contatos importados.`, 'success');
    return { inseridos: inseridos.length };
  };

  const updateLeadStatus = async (id, newStatus) => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from('leads')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
    } catch (error) {
      console.error('[LEADS] Erro ao atualizar status:', error);
      addToast('Erro ao atualizar status do lead.', 'error');
    }
  };

  const updateLead = async (id, updates) => {
    if (!user?.id) return;
    try {
      const dbUpdates = {
        updated_at: new Date().toISOString()
      };
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
      if (updates.email !== undefined) dbUpdates.email = updates.email;
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.birth_date !== undefined) dbUpdates.birth_date = updates.birth_date || null;
      if (updates.family_info !== undefined)     dbUpdates.family_info     = updates.family_info || null;
      if (updates.occupation !== undefined)      dbUpdates.occupation      = updates.occupation || null;
      if (updates.recreation_info !== undefined) dbUpdates.recreation_info = updates.recreation_info || null;
      if (updates.financial_info !== undefined)  dbUpdates.financial_info  = updates.financial_info || null;
      if (updates.trade_in_model !== undefined)              dbUpdates.trade_in_model              = updates.trade_in_model || null;
      if (updates.trade_in_year !== undefined)               dbUpdates.trade_in_year               = updates.trade_in_year || null;
      if (updates.trade_in_km !== undefined)                 dbUpdates.trade_in_km                 = updates.trade_in_km || null;
      if (updates.trade_in_ownership_time !== undefined)     dbUpdates.trade_in_ownership_time     = updates.trade_in_ownership_time || null;
      if (updates.trade_in_owner_rating !== undefined)       dbUpdates.trade_in_owner_rating       = updates.trade_in_owner_rating || null;
      if (updates.trade_in_payment_preference !== undefined) dbUpdates.trade_in_payment_preference = updates.trade_in_payment_preference || null;
      if (updates.trade_in_difference_payment !== undefined) dbUpdates.trade_in_difference_payment = updates.trade_in_difference_payment || null;
      if (updates.trade_in_extra_info !== undefined)         dbUpdates.trade_in_extra_info         = updates.trade_in_extra_info || null;

      const { error } = await supabase
        .from('leads')
        .update(dbUpdates)
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
      addToast('Informações do lead salvas.', 'success');
    } catch (error) {
      console.error('[LEADS] Erro ao atualizar:', error);
      addToast('Erro ao salvar lead.', 'error');
    }
  };

  const deleteLead = async (id) => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from('leads')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setLeads(prev => prev.filter(l => l.id !== id));
      addToast('Lead excluído do sistema.', 'info');
    } catch (error) {
      console.error('[LEADS] Erro ao excluir:', error);
      addToast('Erro ao excluir lead.', 'error');
    }
  };

  // ========== Actions - Agenda (Supabase) ==========
  const addAppointment = async (appt) => {
    if (!user?.id) return;
    try {
      const insertData = {
        user_id: user.id,
        customer_name: appt.customer,
        customer_phone: appt.phone || '',
        customer_email: appt.email || null,
        car_id: appt.car_id || null,
        appointment_date: appt.date,
        appointment_time: appt.time || '10:00',
        notes: appt.notes || '',
        status: 'scheduled'
      };

      const { data: newAppt, error } = await supabase
        .from('appointments')
        .insert([insertData])
        .select()
        .single();

      if (error) throw error;

      const mapped = {
        id: newAppt.id,
        customer: newAppt.customer_name,
        phone: newAppt.customer_phone || '',
        email: newAppt.customer_email || '',
        car: appt.car || '',
        date: newAppt.appointment_date,
        time: newAppt.appointment_time,
        notes: newAppt.notes || '',
        status: 'agendado',
        car_id: newAppt.car_id
      };

      setAppointments(prev => [...prev, mapped]);
      addToast('Novo agendamento criado com sucesso.', 'success');
    } catch (error) {
      console.error('[AGENDA] Erro ao criar agendamento:', error);
      addToast('Erro ao criar agendamento.', 'error');
    }
  };

  const updateAppointmentStatus = async (id, newStatus) => {
    if (!user?.id) return;
    try {
      const dbStatus = STATUS_UI_TO_DB[newStatus] || newStatus;

      const { error } = await supabase
        .from('appointments')
        .update({ status: dbStatus })
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));

      const statusLabels = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', ausente: 'Não Compareceu' };
      addToast(`Status atualizado para ${statusLabels[newStatus] || newStatus}.`, 'info');
    } catch (error) {
      console.error('[AGENDA] Erro ao atualizar status:', error);
      addToast('Erro ao atualizar status.', 'error');
    }
  };

  const updateAppointment = async (id, updates) => {
    if (!user?.id) return;
    try {
      const dbUpdates = {};
      if (updates.date) dbUpdates.appointment_date = updates.date;
      if (updates.time) dbUpdates.appointment_time = updates.time;
      if (updates.customer) dbUpdates.customer_name = updates.customer;
      if (updates.phone !== undefined) dbUpdates.customer_phone = updates.phone;
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

      const { error } = await supabase
        .from('appointments')
        .update(dbUpdates)
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
      addToast('Agendamento remarcado com sucesso.', 'success');
    } catch (error) {
      console.error('[AGENDA] Erro ao remarcar:', error);
      addToast('Erro ao remarcar agendamento.', 'error');
    }
  };

  const deleteAppointment = async (id) => {
    if (!user?.id) return;
    try {
      const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;

      setAppointments(prev => prev.filter(a => a.id !== id));
      addToast('Agendamento removido.', 'info');
    } catch (error) {
      console.error('[AGENDA] Erro ao excluir:', error);
      addToast('Erro ao excluir agendamento.', 'error');
    }
  };

  // ========== Actions - Settings (Supabase) ==========
  const updateCompany = async (updates) => {
    if (!user?.id) return;
    try {
      const dbUpdates = {
        company_name: updates.name || '',
        address: updates.address || '',
        phone_number: updates.phone || '',
        whatsapp_number: updates.whatsapp || '',
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('company_settings')
        .update(dbUpdates)
        .eq('user_id', user.id);

      if (error) throw error;

      // Atualiza estado local
      setCompanySettings(prev => prev ? { ...prev, ...dbUpdates } : dbUpdates);

      // Sincroniza company_name no profiles também
      if (updates.name) {
        await updateProfile({ company_name: updates.name });
      }

      addToast('Perfil da empresa atualizado com sucesso.', 'success');
    } catch (error) {
      console.error('[SETTINGS] Erro ao salvar empresa:', error);
      addToast('Erro ao salvar configurações.', 'error');
    }
  };

  const updateAgendaConfig = async (updates) => {
    if (!user?.id) return;
    try {
      // Converte objeto de dias para string CSV
      const workingDays = Object.entries(updates.days)
        .filter(([, active]) => active)
        .map(([day]) => day)
        .join(',');

      const dbUpdates = {
        business_hours_start: updates.startTime,
        business_hours_end: updates.endTime,
        appointment_duration: Number(updates.duration) || 60,
        appointment_interval: Number(updates.interval) || 15,
        working_days: workingDays,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('company_settings')
        .update(dbUpdates)
        .eq('user_id', user.id);

      if (error) throw error;

      setCompanySettings(prev => prev ? { ...prev, ...dbUpdates } : dbUpdates);
      addToast('Regras da agenda salvas com sucesso.', 'success');
    } catch (error) {
      console.error('[SETTINGS] Erro ao salvar agenda:', error);
      addToast('Erro ao salvar regras da agenda.', 'error');
    }
  };

  // ========== Settings de notificação (aniversário / lista de espera) ==========
  const updateNotificationSettings = async (updates) => {
    if (!user?.id) return false;
    try {
      const dbUpdates = { updated_at: new Date().toISOString() };
      if (updates.birthday_enabled !== undefined) dbUpdates.birthday_enabled = updates.birthday_enabled;
      if (updates.birthday_template_id !== undefined) dbUpdates.birthday_template_id = updates.birthday_template_id || null;
      if (updates.waiting_list_template_id !== undefined) dbUpdates.waiting_list_template_id = updates.waiting_list_template_id || null;

      const { error } = await supabase.from('company_settings').update(dbUpdates).eq('user_id', user.id);
      if (error) throw error;
      setCompanySettings(prev => prev ? { ...prev, ...dbUpdates } : dbUpdates);
      addToast('Configurações de notificação salvas.', 'success');
      return true;
    } catch (e) {
      console.error('[SETTINGS] Erro ao salvar notificações:', e);
      addToast('Erro ao salvar configurações.', 'error');
      return false;
    }
  };

  // ========== Realtime: leads e appointments ==========
  useEffect(() => {
    if (!user?.id) return;

    const userId = user.id;

    // Mapeia um registro bruto do banco para o formato de lead do estado local
    const mapLeadRaw = (raw) => ({
      id: raw.id,
      name: raw.name,
      phone: raw.phone || '',
      email: raw.email || '',
      car: 'Busca genérica', // join não disponível no realtime payload
      status: raw.status,
      notes: raw.notes || '',
      date: raw.created_at,
      birth_date: raw.birth_date || '',
      city: 'Não informada',
      avatar: (raw.name || '?').charAt(0).toUpperCase()
    });

    // Mapeia um registro bruto de appointment para o formato local
    const mapApptRaw = (raw) => ({
      id: raw.id,
      customer: raw.customer_name,
      phone: raw.customer_phone || '',
      email: raw.customer_email || '',
      car: raw.car_id || '',
      date: raw.appointment_date,
      time: raw.appointment_time,
      notes: raw.notes || '',
      status: STATUS_DB_TO_UI[raw.status] || 'agendado',
      car_id: raw.car_id
    });

    const channel = supabase
      .channel(`realtime-crm-${userId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` }, () => {
        // Re-busca para obter o join com cars
        fetchLeads(userId);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` }, (payload) => {
        setLeads(prev => prev.map(l => l.id === payload.new.id ? { ...l, ...mapLeadRaw(payload.new) } : l));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` }, (payload) => {
        setLeads(prev => prev.filter(l => l.id !== payload.old.id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments', filter: `user_id=eq.${userId}` }, (payload) => {
        setAppointments(prev => {
          if (prev.some(a => a.id === payload.new.id)) return prev;
          return [...prev, mapApptRaw(payload.new)].sort((a, b) =>
            a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)
          );
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments', filter: `user_id=eq.${userId}` }, (payload) => {
        setAppointments(prev => prev.map(a => a.id === payload.new.id ? { ...a, ...mapApptRaw(payload.new) } : a));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'appointments', filter: `user_id=eq.${userId}` }, (payload) => {
        setAppointments(prev => prev.filter(a => a.id !== payload.old.id));
      })
      // Lista de espera: qualquer mudança refaz o fetch (mantém badge e página em dia)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_interests', filter: `user_id=eq.${userId}` }, () => {
        fetchVehicleInterests(userId);
      })
      // Templates: qualquer mudança refaz o fetch (status de aprovação atualiza sozinho)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_templates', filter: `user_id=eq.${userId}` }, () => {
        fetchMessageTemplates(userId);
      })
      // Campanhas: status e contadores atualizam sozinhos
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns', filter: `user_id=eq.${userId}` }, () => {
        fetchCampaigns(userId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchLeads, fetchVehicleInterests, fetchMessageTemplates, fetchCampaigns]);

  // ========== Recuperação ao voltar pra aba (sai e volta) ==========
  // Aba em background: o token pode expirar e o websocket do Realtime morre.
  // Ao voltar ao foco: revalida a sessão e reconecta o Realtime — senão as
  // queries ficam penduradas na conexão morta (spinner eterno até F5).
  useEffect(() => {
    if (!user?.id) return;
    let recovering = false;
    const withTimeout = (p, ms) =>
      Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

    const recover = async () => {
      if (document.visibilityState !== 'visible' || recovering) return;
      recovering = true;
      try {
        // 1) sessão: valida e, se preciso, força refresh (com timeout pra não pendurar)
        try {
          await withTimeout(supabase.auth.getSession(), 5000);
        } catch {
          try { await withTimeout(supabase.auth.refreshSession(), 5000); }
          catch (e) { console.warn('[recover] refreshSession falhou:', e); }
        }
        // 2) Realtime: revive o socket (morre no background); canais reingressam
        try { supabase.realtime.disconnect(); supabase.realtime.connect(); }
        catch (e) { console.warn('[recover] realtime reconnect:', e); }
        // 3) re-sincroniza os dados principais (podem ter mudado enquanto dormia)
        const uid = user.id;
        fetchLeads(uid);
        fetchAppointments(uid);
        fetchCompanySettings(uid);
        fetchVehicleInterests(uid);
      } finally {
        recovering = false;
      }
    };

    document.addEventListener('visibilitychange', recover);
    window.addEventListener('focus', recover);
    return () => {
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('focus', recover);
    };
  }, [user?.id, fetchLeads, fetchAppointments, fetchCompanySettings, fetchVehicleInterests]);

  // ========== Context Value ==========
  const value = {
    // Local data spread first, so it doesn't override explicit auth state!
    ...data,
    inventory,      // Sobrescreve data.inventory (Supabase)
    soldCars,       // Sobrescreve data.soldCars (Supabase)
    financialEntries,
    addFinancialEntry,
    removeFinancialEntry,
    recurringExpenses,
    saveRecurringExpense,
    removeRecurringExpense,
    lancarFixasDoMes,
    leads,          // Sobrescreve data.leads (Supabase)
    appointments,   // Sobrescreve data.appointments (Supabase)
    agendaConfig,   // Sobrescreve data.agendaConfig (Supabase company_settings)

    // Auth
    isAuthenticated,
    precisaNovaSenha,
    recuperarSenha,
    confirmarCadastro,
    reenviarConfirmacao,
    definirNovaSenha,
    isLoading,
    user,
    profile,
    session,

    // Company (merged: Supabase company_settings + profile)
    company,

    // Toasts
    toasts,
    addToast,
    removeToast,

    // Inventory
    addInventoryCar,
    updateInventoryCar,
    removeInventoryCar,
    sellCar,

    // Leads
    addLead,
    importLeads,
    updateLeadStatus,
    updateLead,
    deleteLead,

    // Agenda (Supabase)
    addAppointment,
    updateAppointmentStatus,
    updateAppointment,
    deleteAppointment,

    // Auth actions
    login,
    signup,
    logout,

    // Settings (Supabase)
    updateCompany,
    updateAgendaConfig,
    updateProfile,

    // Lista de Espera (vehicle_interests)
    vehicleInterests,
    matchedCount: vehicleInterests.filter(i => i.status === 'matched').length,
    refreshVehicleInterests,
    updateInterestStatus,
    addInterest,
    deleteInterest,
    notifyWaitingListMatch,
    // True quando há template de lista de espera configurado E aprovado
    waitingListTemplateReady: !!(companySettings?.waiting_list_template_id &&
      messageTemplates.some(t => t.id === companySettings.waiting_list_template_id && t.status === 'approved')),

    // Templates Meta
    messageTemplates,
    refreshTemplates,
    saveTemplate,
    deleteTemplate,
    submitTemplate,
    checkTemplateStatus,

    // Campanhas
    campaigns,
    refreshCampaigns,
    createCampaign,
    deleteCampaign,
    sendCampaign,
    fetchCampaignSends,

    // Settings de notificação
    companySettings,
    refreshCompanySettings,
    updateNotificationSettings,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      {/* Container de Toasts global */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
            <button className="toast-close" onClick={() => removeToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
