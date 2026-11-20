import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { buildCors } from '../_shared/cors.ts';
import { resolveWhatsAppToken } from '../_shared/whatsapp.ts';

// Traduz o código de rejeição da Meta para algo que o lojista entenda.
// Mantém o código cru quando não conhecemos o valor: perder informação de
// diagnóstico é pior que mostrar uma sigla em inglês.
const MOTIVOS: Record<string, string> = {
  SCAM: 'A Meta classificou como golpe. Costuma ser confiança da conta, não o texto. Peça revisão.',
  ABUSIVE_CONTENT: 'Conteúdo considerado abusivo pela Meta. Revise o texto antes de reenviar.',
  INCORRECT_CATEGORY: 'Categoria errada: o texto parece ser de outra categoria (marketing x utilidade).',
  INVALID_FORMAT: 'Formato inválido: variáveis, exemplos ou botões fora do padrão da Meta.',
  TAG_CONTENT_MISMATCH: 'O conteúdo não corresponde à categoria declarada no envio.',
  PROMOTIONAL: 'Texto promocional numa categoria que não aceita promoção.',
};

function motivoEmPortugues(code: unknown): string {
  const raw = String(code ?? '').trim().toUpperCase();
  // 'NONE' é o que a Meta manda quando não há motivo registrado — não é o
  // mesmo que a gente ter deixado de perguntar.
  if (!raw || raw === 'NONE') return 'A Meta não informou o motivo.';
  return MOTIVOS[raw] ?? `Motivo da Meta: ${raw}`;
}

serve(async (req) => {
  const corsHeaders = buildCors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Inclui 'rejected' e 'paused' de propósito, não só 'pending': uma
    // apelação aceita pela Meta devolve o template para APPROVED, e se a gente
    // só olhasse os pendentes esse voltar nunca chegaria no banco — o template
    // ficaria rejeitado pra sempre aqui e fora do disparo, mesmo aprovado lá.
    const { data: tracked } = await supabase
      .from('message_templates')
      .select('*')
      .eq('user_id', user_id)
      .in('status', ['pending', 'rejected', 'paused']);

    if (!tracked || tracked.length === 0) {
      return new Response(JSON.stringify({ updated: 0, message: 'Nenhum template em acompanhamento' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const whatsappToken = Deno.env.get('WHATSAPP_TOKEN');
    if (!whatsappToken) {
      return new Response(JSON.stringify({ error: 'WHATSAPP_TOKEN não configurado nas Edge Function Secrets' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // WABA ID por tenant: lê de company_settings; fallback para o secret de ambiente.
    const { data: wabaSettings } = await supabase
      .from('company_settings')
      .select('whatsapp_business_account_id')
      .eq('user_id', user_id)
      .maybeSingle();
    const wabaId = String(
      wabaSettings?.whatsapp_business_account_id || Deno.env.get('WHATSAPP_BUSINESS_ACCOUNT_ID') || '',
    ).trim();
    if (!wabaId) {
      return new Response(JSON.stringify({
        error: 'WABA não configurado para esta conta (company_settings.whatsapp_business_account_id ou secret WHATSAPP_BUSINESS_ACCOUNT_ID).',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const tenantToken = await resolveWhatsAppToken(supabase, user_id);

    // `fields` é OBRIGATÓRIO para vir `rejected_reason`: sem ele a Meta devolve
    // só o conjunto padrão (name/status/id/...) e o motivo chega `undefined`,
    // fazendo todo template rejeitado virar "Não informado" no banco.
    // Queimou em 20/11/2026 — 6 templates da DSC rejeitados e nós cegos ao SCAM.
    const FIELDS = 'name,status,id,category,language,rejected_reason';
    const url = `https://graph.facebook.com/v25.0/${wabaId}/message_templates?fields=${FIELDS}&limit=200`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${tenantToken}` } });
    const data = await response.json();

    if (!response.ok) {
      // Loga o erro cru da Meta (code/message/subcode) para diagnóstico
      console.error('[check-template-status] Meta error:', response.status, JSON.stringify(data?.error ?? data));
      return new Response(JSON.stringify({ error: 'Erro ao consultar Meta', details: data?.error ?? data }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const remoteList = Array.isArray(data.data) ? data.data : [];
    let updated = 0;

    for (const local of tracked) {
      const remote = remoteList.find((t: { name?: string }) => t.name === local.meta_template_name);
      if (!remote) {
        await supabase.from('message_templates')
          .update({ last_status_check: new Date().toISOString() })
          .eq('id', local.id);
        continue;
      }

      const metaStatus = String(remote.status ?? '').toLowerCase();
      let newStatus = local.status;
      if (metaStatus === 'approved') newStatus = 'approved';
      else if (metaStatus === 'rejected') newStatus = 'rejected';
      else if (metaStatus === 'paused') newStatus = 'paused';
      else if (metaStatus === 'disabled') newStatus = 'disabled';

      if (newStatus !== local.status) {
        await supabase.from('message_templates')
          .update({
            status: newStatus,
            meta_template_id: remote.id ?? local.meta_template_id,
            ...(newStatus === 'approved' ? { approved_at: new Date().toISOString() } : {}),
            ...(newStatus === 'rejected' ? { rejection_reason: motivoEmPortugues(remote.rejected_reason) } : {}),
            last_status_check: new Date().toISOString(),
          })
          .eq('id', local.id);
        updated++;
      } else {
        // Status igual, mas o motivo pode estar errado no banco (foi o caso das
        // linhas gravadas antes de pedirmos `rejected_reason`). Regrava sempre
        // que estiver rejeitado, assim as linhas velhas se curam sozinhas.
        const motivoAtual = newStatus === 'rejected'
          ? { rejection_reason: motivoEmPortugues(remote.rejected_reason) }
          : {};
        await supabase.from('message_templates')
          .update({ ...motivoAtual, last_status_check: new Date().toISOString() })
          .eq('id', local.id);
      }
    }

    return new Response(JSON.stringify({ updated, total_pending: tracked.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[check-template-status] exception:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
