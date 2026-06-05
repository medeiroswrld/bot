import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

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

  const [toasts, setToasts] = useState([]);

  // Ref para evitar fetch duplicado de perfil
  const profileFetchedRef = useRef(false);

  // ========== Derived State ==========
  const isAuthenticated = !!session;

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
        .select(`
          *,
          cars ( brand, model, version )
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
        notes: l.notes || '',
        date: l.created_at,
        city: 'Não informada',
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
            try {
              // Chamadas sequenciais para evitar conflito de lock do auth token
              await fetchProfile(newSession.user.id);
              await fetchInventory(newSession.user.id);
              await fetchLeads(newSession.user.id);
              await fetchAppointments(newSession.user.id);
              await fetchCompanySettings(newSession.user.id);
            } catch (err) {
              console.error('[AUTH] Erro ao carregar dados iniciais:', err);
            }
          }
          if (mounted) setIsLoading(false);

        } else if (event === 'SIGNED_IN' && newSession?.user) {
          setSession(newSession);
          setUser(newSession?.user ?? null);

          if (!profileFetchedRef.current) {
            profileFetchedRef.current = true;
            try {
              // Chamadas sequenciais para evitar conflito de lock do auth token
              await fetchProfile(newSession.user.id);
              await fetchInventory(newSession.user.id);
              await fetchLeads(newSession.user.id);
              await fetchAppointments(newSession.user.id);
              await fetchCompanySettings(newSession.user.id);
            } catch (err) {
              console.error('[AUTH] Erro ao carregar dados pós-login:', err);
            }
          }
          if (mounted) setIsLoading(false);

        } else if (event === 'SIGNED_OUT') {
          console.log('[AUTH] Limpando estado local...');
          setSession(null);
          setUser(null);
          setProfile(null);
          setInventory([]);
          setSoldCars([]);
          setLeads([]);
          setAppointments([]);
          setCompanySettings(null);
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
  }, [fetchProfile, fetchInventory, fetchAppointments, fetchCompanySettings]);

  // ========== Auth Actions (Supabase) ==========
  const login = async (email, password) => {
    const { data: authData, error } = await supabase.auth.signInWithPassword({
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

  // ========== Actions - Estoque ==========
  const addInventoryCar = async (car) => {
    console.log('[INVENTORY] addInventoryCar chamado. user.id:', user?.id, 'car:', car?.brand, car?.model);
    if (!user?.id) {
      console.error('[INVENTORY] Abortado: user.id é null/undefined');
      addToast('Erro: sessão expirada. Faça login novamente.', 'error');
      return;
    }
    try {
      const insertData = {
        user_id: user.id,
        brand: car.brand,
        model: car.model,
        version: car.version || '',
        year: Number(car.year),
        price: Number(car.price),
        mileage: Number(car.km) || 0,
        transmission: car.transmission || 'Automático',
        fuel: car.fuel || 'Flex',
        color: car.color || '',
        vehicle_type: car.vehicle_type || 'carro',
        description: car.description || null,
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

      // Chama a sincronização das imagens
      const finalImageUrls = await syncCarImages(newCar.id, car.images || []);

      setInventory(prev => [{ ...newCar, images: finalImageUrls, km: newCar.mileage, status: 'disponivel' }, ...prev]);
      addToast('Veículo adicionado ao estoque com sucesso.', 'success');
    } catch (error) {
      console.error('[INVENTORY] Erro ao adicionar:', error);
      addToast('Erro ao adicionar veículo.', 'error');
    }
  };

  const updateInventoryCar = async (id, updates) => {
    if (!user?.id) return;
    try {
      const dbUpdates = { ...updates };
      delete dbUpdates.images;

      if (dbUpdates.km !== undefined) {
        dbUpdates.mileage = Number(dbUpdates.km) || 0;
        delete dbUpdates.km;
      }
      if (dbUpdates.year !== undefined) dbUpdates.year = Number(dbUpdates.year);
      if (dbUpdates.price !== undefined) dbUpdates.price = Number(dbUpdates.price);
      if (dbUpdates.status === 'disponivel') dbUpdates.status = 'available';
      if (dbUpdates.status === 'vendido') dbUpdates.status = 'sold';

      const { data: updatedCar, error } = await supabase
        .from('cars')
        .update(dbUpdates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
        
      if (error) throw error;

      const finalImageUrls = await syncCarImages(id, updates.images || []);

      setInventory(prev => prev.map(c => c.id === id ? { ...updatedCar, images: finalImageUrls, km: updatedCar.mileage } : c));
      addToast('Informações do veículo atualizadas.', 'success');
    } catch (error) {
      console.error('Erro ao atualizar', error);
      addToast('Erro ao atualizar veículo.', 'error');
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

      setInventory(prev => prev.filter(c => c.id !== id));
      addToast('Veículo removido do estoque.', 'info');
    } catch (error) {
      console.error('Erro ao remover', error);
      addToast('Erro ao remover veículo.', 'error');
    }
  };

  const sellCar = async (inventoryId, salePrice, saleDate, sellerName) => {
    if (!user?.id) return;
    try {
      const { data: updatedCar, error } = await supabase
        .from('cars')
        .update({
          status: 'sold',
          sold_price: Number(salePrice),
          sold_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
          sold_by: sellerName
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
      addToast('Venda registrada com sucesso! Analise o histórico.', 'success');
    } catch (error) {
      console.error('Erro ao vender', error);
      addToast('Erro ao vender veículo.', 'error');
    }
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
        .select(`*, cars (brand, model, version)`)
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
      .channel(`realtime-crm-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads', filter: `user_id=eq.${userId}` }, (payload) => {
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, fetchLeads]);

  // ========== Context Value ==========
  const value = {
    // Local data spread first, so it doesn't override explicit auth state!
    ...data,
    inventory,      // Sobrescreve data.inventory (Supabase)
    soldCars,       // Sobrescreve data.soldCars (Supabase)
    leads,          // Sobrescreve data.leads (Supabase)
    appointments,   // Sobrescreve data.appointments (Supabase)
    agendaConfig,   // Sobrescreve data.agendaConfig (Supabase company_settings)

    // Auth
    isAuthenticated,
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
