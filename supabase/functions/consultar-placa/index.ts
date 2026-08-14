import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';

// Consulta de veículo por placa, pra preencher o cadastro sozinho.
//
// Não existe API oficial e gratuita: o SENATRAN não abre consulta por placa pra
// uso privado. O que existe é um mercado de APIs pagas de consulta veicular.
// Por isso o FORNECEDOR é configurável — a URL e a chave vêm dos secrets, e o
// mapeamento da resposta fica isolado em `normalizar()`. Trocar de fornecedor é
// mexer em um lugar só.
//
// Secrets:
//   PLACA_API_URL  — endpoint com {placa} onde entra a placa.
//                    ex.: https://fornecedor.com.br/api/consulta/{placa}
//   PLACA_API_KEY  — a chave; vai no header Authorization e também como
//                    ?token=, porque os fornecedores divergem nisso.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Aceita placa antiga (ABC1234) e Mercosul (ABC1D23). */
function normalizarPlaca(bruta: string): string | null {
  const p = String(bruta ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{3}[0-9]{4}$/.test(p)) return p;        // antiga
  if (/^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p)) return p; // Mercosul
  return null;
}

/**
 * Achata a resposta e procura os campos que interessam.
 *
 * Cada fornecedor nomeia diferente (marca/MARCA/brand, ano/anoModelo/ano_fabricacao)
 * e alguns aninham tudo dentro de "dados" ou "response". Em vez de casar com um
 * formato só, varre o JSON inteiro pelos nomes conhecidos — assim a maioria dos
 * fornecedores funciona sem alterar código.
 */
function normalizar(payload: Json): Record<string, string> {
  const achatado: Record<string, string> = {};
  const varrer = (obj: Json, profundidade = 0) => {
    if (!obj || typeof obj !== 'object' || profundidade > 4) return;
    for (const [k, v] of Object.entries(obj)) {
      const chave = k.toLowerCase().replace(/[^a-z]/g, '');

      // O RegCheck embrulha vários campos em { CurrentValue, CurrentTextValue }.
      // Sem colapsar isso no nome do PAI, "CarMake" e "FuelType" virariam ambos
      // "currenttextvalue" e um sobrescreveria o outro.
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const interno = v as Record<string, unknown>;
        const texto = interno.CurrentTextValue ?? interno.CurrentValue;
        if (texto !== undefined && texto !== null && texto !== '') {
          if (!(chave in achatado)) achatado[chave] = String(texto);
          continue;
        }
        varrer(v, profundidade + 1);
        continue;
      }

      if (v === null || v === '' || typeof v === 'object') continue;
      if (!(chave in achatado)) achatado[chave] = String(v);
    }
  };
  varrer(payload);

  const primeiro = (...nomes: string[]) => {
    for (const n of nomes) if (achatado[n]) return achatado[n];
    return '';
  };

  // Nomes em pt-BR (fornecedores nacionais) e em inglês (RegCheck/PlacaAPI).
  const anoBruto = primeiro(
    'anomodelo', 'ano', 'anofabricacao', 'anofabricacaomodelo',
    'year', 'registrationyear', 'manufactureyearfrom',
  );
  const marca  = primeiro('marca', 'brand', 'fabricante', 'carmake', 'makedescription');
  const modelo = primeiro('modelo', 'model', 'submodelo', 'carmodel', 'modeldescription');
  const desc   = primeiro('description', 'descricao');

  return {
    marca,
    modelo,
    ano:         (anoBruto.match(/\d{4}/) ?? [''])[0],
    cor:         primeiro('cor', 'color', 'corveiculo', 'colour'),
    combustivel: primeiro('combustivel', 'fuel', 'tipocombustivel', 'fueltype'),
    // Moto já entra marcada como moto. O fornecedor não devolve o tipo, mas o
    // nome entrega ("HONDA MOTO CG 160") — e sem isso o lojista teria que
    // lembrar de trocar o campo toda vez, ou a moto entraria como carro no
    // estoque e apareceria em busca de carro no bot.
    tipo: /\bmoto|motocicl|scooter|tricicl/i.test(`${desc} ${modelo}`) ? 'moto' : 'carro',
  };
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Authorization ausente' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // O JWT vai EXPLÍCITO no getUser. Sem o argumento, o supabase-js procura a
    // sessão no armazenamento local — que não existe no runtime da edge
    // function — e devolve user null mesmo com o header certo. É o padrão que
    // as outras functions autenticadas do projeto já usam.
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authErr || !user) {
      console.warn('[placa] JWT recusado', authErr?.message);
      return json({ error: 'Não autenticado' }, 401);
    }

    const { placa: placaBruta } = await req.json();
    const placa = normalizarPlaca(placaBruta);
    if (!placa) return json({ error: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' }, 400);

    // CACHE — cada consulta é paga. Placa já consultada (por qualquer conta)
    // não gasta de novo: os dados do veículo não mudam.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: cache } = await admin
      .from('plate_lookups').select('dados').eq('plate', placa).maybeSingle();
    if (cache?.dados) {
      console.log('[placa] cache hit', placa);
      return json({ ...cache.dados, placa, cache: true });
    }

    const apiUrl = Deno.env.get('PLACA_API_URL') ?? '';
    const apiKey = Deno.env.get('PLACA_API_KEY') ?? '';
    if (!apiUrl) {
      return json({
        error: 'Consulta por placa ainda não configurada. Falta o secret PLACA_API_URL (e PLACA_API_KEY) com o fornecedor contratado.',
      }, 501);
    }

    // Dois estilos de fornecedor, decididos pela própria URL configurada:
    //   com {placa} → GET, a placa entra no caminho
    //   sem {placa} → POST com {"placa": "..."} no corpo (é o caso da APIBrasil)
    const usaGet = apiUrl.includes('{placa}');
    const url = usaGet ? apiUrl.replace('{placa}', placa) : apiUrl;

    // Cada fornecedor autentica de um jeito. Mandamos as três formas comuns —
    // header Bearer, header DeviceToken (APIBrasil usa DOIS tokens) e ?token= —
    // porque header a mais é ignorado, e assim a mesma função serve a todos.
    const deviceToken = Deno.env.get('PLACA_API_DEVICE_TOKEN') ?? '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (deviceToken) headers.DeviceToken = deviceToken;

    const res = usaGet
      ? await fetch(
        apiKey && !deviceToken
          ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(apiKey)}`
          : url,
        { headers },
      )
      : await fetch(url, { method: 'POST', headers, body: JSON.stringify({ placa }) });
    const corpo = await res.text();

    if (!res.ok) {
      console.error('[placa] fornecedor recusou', res.status, corpo.slice(0, 300));
      return json({ error: `O serviço de consulta respondeu ${res.status}. Confira a placa ou o saldo do plano.` }, 502);
    }

    // O RegCheck (usado pelo PlacaAPI) responde XML com o JSON de verdade dentro
    // da tag <vehicleJson>, escapado. Sem tratar isso, todo retorno dele cairia
    // como "formato inesperado".
    let payload: Json;
    const bruto = corpo.trim();
    try {
      if (bruto.startsWith('<')) {
        const m = bruto.match(/<vehicleJson>([\s\S]*?)<\/vehicleJson>/i);
        if (!m) throw new Error('XML sem vehicleJson');
        const desescapado = m[1]
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        payload = JSON.parse(desescapado);
      } else {
        payload = JSON.parse(bruto);
      }
    } catch {
      console.error('[placa] resposta ilegível', bruto.slice(0, 300));
      return json({ error: 'Resposta do serviço de consulta em formato inesperado.' }, 502);
    }

    const dados = normalizar(payload);
    if (!dados.marca && !dados.modelo) {
      // Loga só as CHAVES, nunca os valores: ajuda a calibrar o mapeamento sem
      // despejar dado de veículo/proprietário no log.
      console.warn('[placa] não consegui mapear os campos', {
        placa, chaves: Object.keys(payload ?? {}),
      });
      return json({ error: 'Não consegui ler os dados desse veículo. A placa existe, mas o formato da resposta é diferente do esperado.' }, 422);
    }

    await admin.from('plate_lookups').upsert(
      { plate: placa, dados, consulted_by: user.id },
      { onConflict: 'plate' },
    );

    console.log('[placa] consultado', placa, dados.marca, dados.modelo);
    return json({ ...dados, placa, cache: false });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[placa] exceção:', msg);
    return json({ error: msg }, 500);
  }
});
