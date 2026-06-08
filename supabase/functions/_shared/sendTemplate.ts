// Helper para enviar mensagens de TEMPLATE aprovado via WhatsApp Cloud API.
// Usado por send-campaign, send-birthday-messages e notify-waiting-list-match.

export interface TemplateParameter {
  type: 'text' | 'currency' | 'date_time' | 'image' | 'video';
  text?: string;
}

export interface SendTemplateOptions {
  phone: string;
  templateName: string;
  language: string;            // ex.: 'pt_BR'
  bodyParameters?: TemplateParameter[];
  headerParameters?: TemplateParameter[];
  phoneNumberId: string;
  token: string;
}

export interface SendTemplateResult {
  success: boolean;
  messageId: string | null;
  raw: unknown;
}

export async function sendWhatsAppTemplate(opts: SendTemplateOptions): Promise<SendTemplateResult> {
  const url = `https://graph.facebook.com/v25.0/${opts.phoneNumberId}/messages`;

  const components: Array<Record<string, unknown>> = [];
  if (opts.headerParameters?.length) {
    components.push({ type: 'header', parameters: opts.headerParameters });
  }
  if (opts.bodyParameters?.length) {
    components.push({ type: 'body', parameters: opts.bodyParameters });
  }

  const body = {
    messaging_product: 'whatsapp',
    to: opts.phone,
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.language },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`WhatsApp template send error: ${JSON.stringify(result)}`);
  }

  return {
    success: true,
    messageId: (result as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? null,
    raw: result,
  };
}
