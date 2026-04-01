import React, { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext();

// Funções utilitárias para datas
export const getTodayStr = () => new Date().toISOString().split('T')[0];
export const formatDateStr = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR');
};

const INITIAL_STATE = {
  isAuthenticated: false,
  company: {
    name: 'AutomaticGen Auto',
    address: 'Av. das Nações Unidas, 1234 - SP',
    phone: '(11) 4002-8922',
    whatsapp: '(11) 98765-4321'
  },
  agendaConfig: {
    days: { Seg: true, Ter: true, Qua: true, Qui: true, Sex: true, Sab: true, Dom: false },
    startTime: '09:00',
    endTime: '18:00',
    duration: '60',
    interval: '15'
  },
  inventory: [
    {
      id: 'i1', brand: 'Toyota', model: 'Corolla', version: 'XEi 2.0 Flex',
      year: '2023', price: 148900, km: '15.000', transmission: 'Automático',
      fuel: 'Flex', color: 'Prata', status: 'disponivel',
      image: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?q=80&w=400&auto=format&fit=crop',
      addedAt: '2026-03-10'
    },
    {
      id: 'i2', brand: 'Honda', model: 'Civic', version: 'Touring 1.5 Turbo',
      year: '2022', price: 165000, km: '22.400', transmission: 'Automático',
      fuel: 'Gasolina', color: 'Preto', status: 'disponivel',
      image: 'https://images.unsplash.com/photo-1594070319944-7c0c63148147?q=80&w=400&auto=format&fit=crop',
      addedAt: '2026-03-20'
    },
    {
      id: 'i3', brand: 'Jeep', model: 'Compass', version: 'Longitude T270',
      year: '2023', price: 172500, km: '8.000', transmission: 'Automático',
      fuel: 'Flex', color: 'Branco', status: 'reservado',
      image: 'https://images.unsplash.com/photo-1611859328053-3cbc9f9399f4?q=80&w=400&auto=format&fit=crop',
      addedAt: '2026-03-25'
    },
    {
      id: 'i4', brand: 'Volkswagen', model: 'Nivus', version: 'Highline 200 TSI',
      year: '2021', price: 112900, km: '35.000', transmission: 'Automático',
      fuel: 'Flex', color: 'Cinza', status: 'disponivel',
      image: 'https://images.unsplash.com/photo-1625231334168-35067f8853ed?q=80&w=400&auto=format&fit=crop',
      addedAt: '2026-03-28'
    },
    {
      id: 'i5', brand: 'Hyundai', model: 'HB20S', version: 'Platinum 1.0 TGDI',
      year: '2024', price: 105900, km: '3.200', transmission: 'Automático',
      fuel: 'Flex', color: 'Azul', status: 'disponivel',
      image: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?q=80&w=400&auto=format&fit=crop',
      addedAt: '2026-04-01'
    }
  ],
  soldCars: [
    {
      id: 's1', brand: 'Fiat', model: 'Pulse', version: 'Drive 1.3',
      year: '2023', salePrice: 89900, originalPrice: 92000, km: '12.000',
      saleDate: '2026-03-15', color: 'Vermelho',
      image: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?q=80&w=400&auto=format&fit=crop'
    },
    {
      id: 's2', brand: 'Chevrolet', model: 'Onix', version: 'Premier 1.0 Turbo',
      year: '2022', salePrice: 78500, originalPrice: 82000, km: '28.000',
      saleDate: '2026-03-05', color: 'Branco',
      image: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?q=80&w=400&auto=format&fit=crop'
    }
  ],
  leads: [
    { id: 'l1', name: 'Roberto Oliveira', phone: '(11) 98765-4321', car: 'Toyota Corolla', income: 'R$ 8.500', entry: 'R$ 30.000', city: 'São Paulo', date: getTodayStr(), status: 'novo', avatar: 'RO' },
    { id: 'l2', name: 'Ana Paula Santos', phone: '(21) 99888-7766', car: 'Honda Civic', income: 'R$ 12.000', entry: 'R$ 50.000', city: 'Rio de Janeiro', date: '2026-03-31', status: 'atendimento', avatar: 'AP' },
    { id: 'l3', name: 'Marcos Vinícius', phone: '(31) 98877-6655', car: 'Jeep Compass', income: 'R$ 15.000', entry: 'R$ 45.000', city: 'Belo Horizonte', date: '2026-03-30', status: 'agendado', avatar: 'MV' },
    { id: 'l4', name: 'Juliana Costa', phone: '(11) 97766-5544', car: 'VW Nivus', income: 'R$ 7.000', entry: 'R$ 20.000', city: 'Campinas', date: '2026-03-29', status: 'fechado', avatar: 'JC' },
  ],
  appointments: [
    { id: 'a1', customer: 'Ricardo Almeida', phone: '(11) 91234-5678', car: 'Toyota Corolla', date: getTodayStr(), time: '14:30', status: 'confirmado', notes: 'Quer testar motor na rodovia' },
    { id: 'a2', customer: 'Fernanda Lima', phone: '(11) 92233-4455', car: 'Honda Civic', date: getTodayStr(), time: '16:00', status: 'agendado', notes: 'Trazer esposa' },
    { id: 'a3', customer: 'Mariana Costa', phone: '(11) 96677-8899', car: 'Fiat Pulse', date: '2026-03-31', time: '15:00', status: 'realizado', notes: 'Gostou, vai fechar amanhã' },
  ]
};

export const AppProvider = ({ children }) => {
  const [data, setData] = useState(() => {
    // Tenta carregar do localStorage, se não usa o estado mock inicial
    const saved = localStorage.getItem('automaticGenData');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Erro processando dados do LS", e);
      }
    }
    return INITIAL_STATE;
  });

  const [toasts, setToasts] = useState([]);

  // Atualiza Local Storage silenciomante sempre que dados mudam
  React.useEffect(() => {
    localStorage.setItem('automaticGenData', JSON.stringify(data));
  }, [data]);

  // Toast System
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

  // Actions - Estoque
  const addInventoryCar = (car) => {
    setData(prev => ({
      ...prev,
      inventory: [{ id: Date.now().toString(), addedAt: getTodayStr(), ...car }, ...prev.inventory]
    }));
    addToast('Veículo adicionado ao estoque com sucesso.', 'success');
  };

  const updateInventoryCar = (id, updates) => {
    setData(prev => ({
      ...prev,
      inventory: prev.inventory.map(c => c.id === id ? { ...c, ...updates } : c)
    }));
    addToast('Informações do veículo atualizadas.', 'success');
  };

  const removeInventoryCar = (id) => {
    setData(prev => ({
      ...prev,
      inventory: prev.inventory.filter(c => c.id !== id)
    }));
    addToast('Veículo removido do estoque.', 'info');
  };

  const sellCar = (inventoryId, salePrice, saleDate) => {
    setData(prev => {
      const carToSell = prev.inventory.find(c => c.id === inventoryId);
      if (!carToSell) return prev;

      const newSoldCar = {
        id: `s${Date.now()}`,
        brand: carToSell.brand,
        model: carToSell.model,
        version: carToSell.version,
        year: carToSell.year,
        salePrice: Number(salePrice),
        originalPrice: Number(carToSell.price),
        km: carToSell.km,
        saleDate,
        color: carToSell.color,
        image: carToSell.image
      };

      return {
        ...prev,
        inventory: prev.inventory.filter(c => c.id !== inventoryId),
        soldCars: [newSoldCar, ...prev.soldCars]
      };
    });
    addToast('Venda registrada com sucesso! Analise o histórico.', 'success');
  };

  // Actions - Leads
  const updateLeadStatus = (id, newStatus) => {
    setData(prev => ({
      ...prev,
      leads: prev.leads.map(l => l.id === id ? { ...l, status: newStatus } : l)
    }));
  };

  // Actions - Agenda
  const addAppointment = (appt) => {
    setData(prev => ({
      ...prev,
      appointments: [...prev.appointments, { id: Date.now().toString(), status: 'agendado', ...appt }]
    }));
    addToast('Novo agendamento criado com sucesso.', 'success');
  };

  const updateAppointmentStatus = (id, newStatus) => {
    setData(prev => ({
      ...prev,
      appointments: prev.appointments.map(a => a.id === id ? { ...a, status: newStatus } : a)
    }));
    addToast(`Status do agendamento atualizado para ${newStatus}.`, 'info');
  };

  const updateAppointment = (id, updates) => {
    setData(prev => ({
      ...prev,
      appointments: prev.appointments.map(a => a.id === id ? { ...a, ...updates } : a)
    }));
    addToast(`Agendamento remarcado com sucesso.`, 'success');
  };

  // Actions - Auth
  const login = async (email, password) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        setData(prev => ({ ...prev, isAuthenticated: true }));
        addToast('Login realizado com sucesso!', 'success');
        resolve({ success: true });
      }, 1500);
    });
  };

  const logout = () => {
    setData(prev => ({ ...prev, isAuthenticated: false }));
    addToast('Sessão encerrada.', 'info');
  };

  // Actions - Settings
  const updateCompany = (updates) => {
    setData(prev => ({ ...prev, company: updates }));
    addToast('Perfil da empresa atualizado com sucesso.', 'success');
  };

  const updateAgendaConfig = (updates) => {
    setData(prev => ({ ...prev, agendaConfig: updates }));
    addToast('Regras da agenda salvas com sucesso.', 'success');
  };


  const value = {
    ...data,
    toasts,
    addToast,
    removeToast,
    
    // Inventory
    addInventoryCar,
    updateInventoryCar,
    removeInventoryCar,
    sellCar,

    // Leads
    updateLeadStatus,

    // Agenda
    addAppointment,
    updateAppointmentStatus,
    updateAppointment,

    // Auth
    login,
    logout,

    // Settings
    updateCompany,
    updateAgendaConfig,
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
