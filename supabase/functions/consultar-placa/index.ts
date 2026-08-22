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
  //
  // Fabricação e modelo vinham colapsados num campo só, com `anomodelo` na
  // frente. A Placa Fipe manda os dois separados e a Webmotors exige os dois
  // separados (AnoFabricacao e AnoDoModelo), então agora cada um tem o seu.
  // Quem só devolve um ano continua funcionando: cada lado cai no outro.
  const soAno = (v: string) => (v.match(/\d{4}/) ?? [''])[0];
  const anoFab = primeiro(
    'ano', 'anofabricacao', 'anofabricacaomodelo',
    'year', 'registrationyear', 'manufactureyearfrom',
  );
  const anoMod = primeiro('anomodelo', 'modelyear');
  const marca  = primeiro('marca', 'brand', 'fabricante', 'carmake', 'makedescription');
  const modelo = primeiro('modelo', 'model', 'submodelo', 'carmodel', 'modeldescription');
  const desc   = primeiro('description', 'descricao');
  // A Placa Fipe nao manda `description`, mas classifica o veiculo em
  // `segmento`/`sub_segmento` ("MOTO", "AU - SEDAN PEQUENO"). E sinal melhor
  // que adivinhar pelo nome do modelo.
  const classificacao = `${primeiro('segmento')} ${primeiro('subsegmento')}`;

  return {
    marca,
    modelo,
    ano:          soAno(anoFab || anoMod),
    ano_modelo:   soAno(anoMod || anoFab),
    cor:          primeiro('cor', 'color', 'corveiculo', 'colour'),
    combustivel:  primeiro('combustivel', 'fuel', 'tipocombustivel', 'fueltype'),
    // Campos que a consulta já traz e que antes eram jogados fora. Nenhum é
    // obrigatório: fornecedor que não mandar simplesmente devolve vazio, e a
    // tela só mostra o que veio.
    municipio:    primeiro('municipio', 'cidade', 'city'),
    uf:           primeiro('uf', 'estado', 'state'),
    cilindradas:  primeiro('cilindradas', 'cilindrada', 'enginesize'),
    segmento:     primeiro('segmento'),
    sub_segmento: primeiro('subsegmento'),
    // Vem mascarado (******6889). Serve de conferência visual, mas NÃO é
    // gravado no veículo: o contrato de venda precisa do chassi inteiro, e
    // preencher com máscara colocaria um dado falso no documento.
    chassi:       primeiro('chassi', 'chassis', 'vin'),
    // Moto já entra marcada como moto. O fornecedor não devolve o tipo, mas o
    // nome entrega ("HONDA MOTO CG 160") — e sem isso o lojista teria que
    // lembrar de trocar o campo toda vez, ou a moto entraria como carro no
    // estoque e apareceria em busca de carro no bot.
    tipo: /\bmoto|motocicl|scooter|tricicl/i.test(`${classificacao} ${desc} ${modelo}`) ? 'moto' : 'carro',
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

    // Credencial em HEADER apenas. Nada é acrescentado à query string.
    //
    // A versão anterior anexava `&token=...` quando havia uma chave configurada,
    // e isso derrubava o RegCheck: o método CheckBrazil aceita exatamente
    // RegistrationNumber e username, e um serviço .asmx do ASP.NET tenta mapear
    // CADA parâmetro da query num argumento do método — parâmetro desconhecido
    // estoura "Runtime Error", que foi o 500 que a gente perseguiu.
    //
    // Quem precisa de credencial na URL (o próprio RegCheck usa ?username=)
    // coloca direto no PLACA_API_URL, que é secreto de qualquer forma.
    const deviceToken = Deno.env.get('PLACA_API_DEVICE_TOKEN') ?? '';
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (deviceToken) headers.DeviceToken = deviceToken;

    const res = usaGet
      ? await fetch(url, { headers })
      : await fetch(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ placa }),
        },
      );
    const corpo = await res.text();

    if (!res.ok) {
      // O RegCheck devolve 500 com o motivo em texto dentro do XML
      // (<faultstring>, <Message> ou <string>). Sem extrair, o lojista via só
      // "respondeu 500" e não tinha como saber se era placa inexistente,
      // crédito acabado ou credencial errada — três coisas bem diferentes.
      const motivo = (
        corpo.match(/<faultstring>([\s\S]*?)<\/faultstring>/i) ??
        corpo.match(/<Message>([\s\S]*?)<\/Message>/i) ??
        corpo.match(/<string[^>]*>([\s\S]*?)<\/string>/i)
      )?.[1]?.replace(/<[^>]+>/g, '').trim();

      console.error('[placa] fornecedor recusou', res.status, corpo.slice(0, 400));

      // O RegCheck estoura exceção (página "Runtime Error" do ASP.NET) quando
      // a placa não está na base dele, em vez de responder "não encontrado".
      // Como a página genérica não diz o motivo, o erro técnico não ajuda
      // ninguém — o que o lojista precisa saber é que a placa não retornou.
      const paginaDeErro = /<!DOCTYPE html|<html/i.test(corpo);

      return json({
        error: motivo
          ? `O serviço de consulta recusou: "${motivo}"`
          : paginaDeErro
            ? 'Não encontramos esse veículo na base de consulta. Confira se a placa está correta — se estiver, o veículo pode não constar lá e você pode cadastrar manualmente.'
            : `O serviço de consulta respondeu ${res.status}. Confira a placa ou o saldo do plano.`,
      }, 502);
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

    // A Placa Fipe responde 200 mesmo quando da errado, com o motivo em
    // `codigo`/`msg` (e alguns fornecedores usam `erro`). Sem tratar aqui, cota
    // estourada passaria batido e cairia no "nao consegui ler os dados" la
    // embaixo — a mesma mensagem enganosa que ja custou meia hora de caca ao
    // problema errado com o fornecedor anterior.
    const raiz = (payload ?? {}) as Record<string, unknown>;
    const codigo = Number(raiz.codigo ?? NaN);
    const msg = String(raiz.msg ?? raiz.erro ?? '').trim();
    if ((Number.isFinite(codigo) && codigo !== 1) || raiz.erro) {
      console.error('[placa] fornecedor recusou', { codigo, msg });
      const cota = /limite|cota|excedid/i.test(msg);
      return json({
        error: cota
          ? 'O limite diario de consultas por placa acabou. Ele volta a valer amanha — por enquanto preencha os dados manualmente.'
          : msg || 'A consulta nao retornou dados para essa placa.',
      }, cota ? 429 : 404);
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

    // Guarda também a resposta crua (migration 058). O retry sem `bruto` existe
    // porque function e migration não sobem juntas: se o deploy chegar antes do
    // SQL, a coluna não existe e o upsert inteiro falharia calado — a placa
    // sairia do cache e seria cobrada de novo na próxima consulta. Já aconteceu
    // três vezes neste projeto, sempre em silêncio.
    const linha = { plate: placa, dados, consulted_by: user.id };
    const { error: erroCache } = await admin
      .from('plate_lookups').upsert({ ...linha, bruto: payload }, { onConflict: 'plate' });
    if (erroCache) {
      console.warn('[placa] cache sem o bruto:', erroCache.message);
      await admin.from('plate_lookups').upsert(linha, { onConflict: 'plate' });
    }

    console.log('[placa] consultado', placa, dados.marca, dados.modelo);
    return json({ ...dados, placa, cache: false });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[placa] exceção:', msg);
    return json({ error: msg }, 500);
  }
});
