// estoque-publico — o estoque da loja, legível pelo site dela.
//
// É de leitura pública de propósito: quem tem o token, lê. Por isso o que sai
// daqui é EXATAMENTE o que estaria num anúncio, e nada além. Placa e chassi
// ficam de fora — anúncio com placa exposta é material de clonagem, que é golpe
// corrente neste mercado. Dado de comprador e preço de compra idem.
//
// Não existe sincronização: o site consulta e recebe o estado atual. Carro
// vendido some porque a consulta não o traz mais, não porque alguém avisou.
// Isso elimina a classe inteira de bugs de "o site ficou desatualizado".
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// Aberto a qualquer origem: o consumidor é o site da loja, em outro domínio.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/** Escapa texto para XML — descrição de veículo vem com & e aspas o tempo todo. */
function xmlEscape(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);

  // Aceita o token no caminho (/estoque-publico/abc123) e na query (?t=abc123).
  // O caminho é mais bonito de colar num site; a query é mais fácil de montar em
  // ferramenta que não deixa mexer na URL.
  const doCaminho = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const token = (url.searchParams.get('t') || (doCaminho === 'estoque-publico' ? '' : doCaminho)).trim();

  const formato = (url.searchParams.get('f') ?? 'json').toLowerCase();

  const erro = (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  if (!/^[a-f0-9]{16,64}$/i.test(token)) return erro('Token inválido.', 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: loja, error: lojaErr } = await admin
    .from('company_settings')
    .select('user_id, company_name, suspenso')
    .eq('feed_token', token)
    .maybeSingle();

  if (lojaErr) {
    console.error('[feed] falha ao resolver token:', lojaErr.message);
    return erro('Não consegui carregar o estoque agora.', 500);
  }
  if (!loja) return erro('Estoque não encontrado.', 404);

  // Loja suspensa não some do ar com estoque zerado — isso apagaria o site dela
  // sem explicação. Devolve 402 para o site poder manter o que já renderizou.
  if (loja.suspenso) return erro('Estoque temporariamente indisponível.', 402);

  const { data: carros, error: carrosErr } = await admin
    .from('cars')
    .select(
      'id, brand, model, version, year, mileage, price, color, transmission, ' +
      'fuel, vehicle_type, description, video_url, created_at, ' +
      'car_images(image_url, sort_order)',
    )
    .eq('user_id', loja.user_id)
    .in('status', ['available', 'reserved'])
    .order('created_at', { ascending: false });

  if (carrosErr) {
    console.error('[feed] falha ao ler estoque:', carrosErr.message);
    return erro('Não consegui carregar o estoque agora.', 500);
  }

  // Sem tipos gerados, o supabase-js não consegue inferir o select com relação
  // embutida (`car_images(...)`) e cai em GenericStringError. O formato é o do
  // select acima; o cast é a forma padrão de dizer isso a ele.
  type Img = { image_url: string | null; sort_order: number | null };
  type CarRow = {
    id: string;
    brand: string | null; model: string | null; version: string | null;
    year: number | null; mileage: number | null; price: number | null;
    color: string | null; transmission: string | null; fuel: string | null;
    vehicle_type: string | null; description: string | null;
    video_url: string | null; created_at: string;
    car_images: Img[] | null;
  };

  const veiculos = ((carros ?? []) as unknown as CarRow[]).map((c) => ({
    id:          c.id,
    marca:       c.brand ?? '',
    modelo:      c.model ?? '',
    versao:      c.version ?? '',
    ano:         c.year ?? null,
    km:          c.mileage ?? 0,
    preco:       c.price ?? null,
    cor:         c.color ?? '',
    cambio:      c.transmission ?? '',
    combustivel: c.fuel ?? '',
    tipo:        c.vehicle_type ?? 'carro',
    descricao:   c.description ?? '',
    video:       c.video_url ?? null,
    // Os buckets de mídia já são públicos, então a URL guardada serve direto
    // num site externo — sem proxy e sem assinatura.
    fotos: (c.car_images ?? [])
      .slice()
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
      .map((i) => i.image_url)
      .filter(Boolean),
    entrou_em: c.created_at,
  }));

  // Cinco minutos de cache: o site aguenta a carga e o carro vendido sai do ar
  // rápido o bastante para ninguém ligar perguntando por ele.
  const cache = 'public, max-age=300, s-maxage=300';

  if (formato === 'xml') {
    const itens = veiculos.map((v) => `    <veiculo>
      <id>${xmlEscape(v.id)}</id>
      <marca>${xmlEscape(v.marca)}</marca>
      <modelo>${xmlEscape(v.modelo)}</modelo>
      <versao>${xmlEscape(v.versao)}</versao>
      <ano>${xmlEscape(v.ano)}</ano>
      <km>${xmlEscape(v.km)}</km>
      <preco>${xmlEscape(v.preco)}</preco>
      <cor>${xmlEscape(v.cor)}</cor>
      <cambio>${xmlEscape(v.cambio)}</cambio>
      <combustivel>${xmlEscape(v.combustivel)}</combustivel>
      <tipo>${xmlEscape(v.tipo)}</tipo>
      <descricao>${xmlEscape(v.descricao)}</descricao>
      <fotos>${v.fotos.map((f) => `<foto>${xmlEscape(f)}</foto>`).join('')}</fotos>
    </veiculo>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<estoque loja="${xmlEscape(loja.company_name)}" total="${veiculos.length}" atualizado="${new Date().toISOString()}">
${itens}
</estoque>`;

    return new Response(xml, {
      headers: { ...CORS, 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': cache },
    });
  }

  return new Response(
    JSON.stringify({
      loja: loja.company_name ?? '',
      total: veiculos.length,
      atualizado: new Date().toISOString(),
      veiculos,
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache } },
  );
});
