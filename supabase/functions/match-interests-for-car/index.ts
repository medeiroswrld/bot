import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const lower = (v: unknown) => String(v ?? '').toLowerCase();

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { car_id } = await req.json();
    if (!car_id) {
      return new Response(JSON.stringify({ error: 'car_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Busca o carro
    const { data: car, error: carErr } = await supabase
      .from('cars')
      .select('*')
      .eq('id', car_id)
      .single();

    if (carErr || !car) {
      return new Response(JSON.stringify({ error: 'Carro não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Nome combinado do carro (a tabela não tem coluna "name")
    const carName = [car.brand, car.model, car.version].filter(Boolean).join(' ');
    const carKm   = Number(car.mileage ?? 0);

    // Interesses ativos do mesmo dono
    const { data: interests, error: intErr } = await supabase
      .from('vehicle_interests')
      .select('*')
      .eq('user_id', car.user_id)
      .eq('status', 'active');

    if (intErr) {
      console.error('[match-interests] erro:', JSON.stringify(intErr));
      return new Response(JSON.stringify({ error: intErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filtra os matches em código
    const matches = (interests ?? []).filter((it) => {
      // Modelo: fuzzy — o modelo procurado precisa estar contido no nome do carro
      if (it.model && !lower(carName).includes(lower(it.model))) return false;
      // Marca: exato (case-insensitive) se especificada
      if (it.brand && lower(car.brand) !== lower(it.brand)) return false;
      // Ano
      if (it.year_min && car.year < it.year_min) return false;
      if (it.year_max && car.year > it.year_max) return false;
      // KM (coluna mileage)
      if (it.km_max && carKm > it.km_max) return false;
      // Preço
      if (it.price_min && car.price < it.price_min) return false;
      if (it.price_max && car.price > it.price_max) return false;
      // Tipo
      if (it.vehicle_type && lower(car.vehicle_type) !== lower(it.vehicle_type)) return false;
      // Câmbio
      if (it.transmission && lower(car.transmission) !== lower(it.transmission)) return false;
      // Combustível
      if (it.fuel && lower(car.fuel) !== lower(it.fuel)) return false;
      // Cor
      if (it.color && lower(car.color) !== lower(it.color)) return false;
      return true;
    });

    // Marca os interesses que bateram como 'matched' e incrementa matches_count
    if (matches.length > 0) {
      await Promise.all(matches.map((m) =>
        supabase
          .from('vehicle_interests')
          .update({ status: 'matched', matches_count: (Number(m.matches_count) || 0) + 1 })
          .eq('id', m.id),
      ));
    }

    console.log(`[match-interests] car ${car_id} (${carName}) → ${matches.length} matches`);

    return new Response(JSON.stringify({
      car: { id: car.id, name: carName, year: car.year, price: car.price, km: carKm },
      matches_count: matches.length,
      matches: matches.map((m) => ({
        id: m.id,
        customer_name: m.customer_name,
        customer_phone: m.customer_phone,
        model: m.model,
        notes: m.notes,
        created_at: m.created_at,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[match-interests] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
