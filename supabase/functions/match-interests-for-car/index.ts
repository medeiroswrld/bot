import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

import { buildCors } from '../_shared/cors.ts';

const lower = (v: unknown) => String(v ?? '').toLowerCase();

serve(async (req) => {
  const corsHeaders = buildCors(req);
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

    // Normaliza pra comparar: minúsculas + trim. (Pro modelo, "1.0" vs "1,0" não
    // importa — a comparação é por "contém Onix", não pela versão.)
    const norm = (v: unknown) => lower(v).trim();

    // Filtra os matches em código, guardando o MOTIVO de cada reprovação.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matches: any[] = [];
    const rejections: Array<{ id: string; field: string; iv: unknown; cv: unknown }> = [];

    for (const it of (interests ?? [])) {
      let rej: { field: string; iv: unknown; cv: unknown } | null = null;

      // Modelo: CONTÉM — o modelo do interesse precisa estar contido no nome do
      // carro (marca + modelo + versão). Ex: "Onix" casa com "Chevrolet Onix 1.0".
      if (it.model && !norm(carName).includes(norm(it.model)))
        rej = { field: 'model', iv: it.model, cv: carName };
      // Igualdade exata (marca/tipo/câmbio/combustível/cor): só reprova se AMBOS
      // tiverem valor — carro com o campo vazio passa (benefício da dúvida).
      else if (it.brand && car.brand && norm(car.brand) !== norm(it.brand))
        rej = { field: 'brand', iv: it.brand, cv: car.brand };
      else if (it.year_min && car.year < it.year_min)
        rej = { field: 'year_min', iv: it.year_min, cv: car.year };
      else if (it.year_max && car.year > it.year_max)
        rej = { field: 'year_max', iv: it.year_max, cv: car.year };
      else if (it.km_max && carKm > it.km_max)
        rej = { field: 'km_max', iv: it.km_max, cv: carKm };
      else if (it.price_min && car.price < it.price_min)
        rej = { field: 'price_min', iv: it.price_min, cv: car.price };
      else if (it.price_max && car.price > it.price_max)
        rej = { field: 'price_max', iv: it.price_max, cv: car.price };
      else if (it.vehicle_type && car.vehicle_type && norm(car.vehicle_type) !== norm(it.vehicle_type))
        rej = { field: 'vehicle_type', iv: it.vehicle_type, cv: car.vehicle_type };
      else if (it.transmission && car.transmission && norm(car.transmission) !== norm(it.transmission))
        rej = { field: 'transmission', iv: it.transmission, cv: car.transmission };
      else if (it.fuel && car.fuel && norm(car.fuel) !== norm(it.fuel))
        rej = { field: 'fuel', iv: it.fuel, cv: car.fuel };
      else if (it.color && car.color && norm(car.color) !== norm(it.color))
        rej = { field: 'color', iv: it.color, cv: car.color };

      if (rej) rejections.push({ id: it.id, ...rej });
      else matches.push(it);
    }

    // Quando NINGUÉM bateu, loga o motivo por interesse — pra ver qual campo derrubou.
    if (matches.length === 0 && (interests?.length ?? 0) > 0) {
      for (const r of rejections) {
        console.log(`[match] interest ${r.id} reprovado por ${r.field} (interesse="${r.iv}" vs carro="${r.cv}")`);
      }
    }

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
