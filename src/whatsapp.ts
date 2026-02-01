const KAPSO_API_KEY = process.env.KAPSO_API_KEY!;
const KAPSO_PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID!;

const MAX_MESSAGE_LENGTH = 4000; // WhatsApp limit is ~4096

export async function sendWhatsAppImage(to: string, mediaId: string, caption?: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: {
          id: mediaId,
          ...(caption && { caption }),
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp image send error:', await response.text());
  }
}

export async function sendWhatsApp(to: string, text: string): Promise<void> {
  // Split long messages
  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);

  for (const chunk of chunks) {
    await sendChunk(to, chunk);
  }
}

export async function sendCommandsList(to: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: {
            text: 'Comandos disponiveis:',
          },
          action: {
            button: 'Ver comandos',
            sections: [
              {
                title: 'Sessao',
                rows: [
                  {
                    id: 'cmd_reset',
                    title: '/reset',
                    description: 'Limpar sessao e iniciar nova conversa',
                  },
                  {
                    id: 'cmd_compact',
                    title: '/compact',
                    description: 'Compactar contexto da conversa',
                  },
                ],
              },
              {
                title: 'Informacoes',
                rows: [
                  {
                    id: 'cmd_help',
                    title: '/help',
                    description: 'Mostrar ajuda',
                  },
                ],
              },
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

export async function sendModelSelector(to: string, messageId?: string): Promise<void> {
  const body: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: 'Modelo:',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: `model_haiku_${Date.now()}`,
              title: 'Haiku',
            },
          },
          {
            type: 'reply',
            reply: {
              id: `model_opus_${Date.now()}`,
              title: 'Opus',
            },
          },
        ],
      },
    },
  };

  // Reply to original message if we have the ID
  if (messageId) {
    body.context = { message_id: messageId };
  }

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

async function sendChunk(to: string, text: string): Promise<void> {
  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v20.0/${KAPSO_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );

  if (!response.ok) {
    console.error('WhatsApp send error:', await response.text());
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find last newline within limit
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // No good newline, split at space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1 || splitAt < maxLength / 2) {
      // No good space, hard split
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
