import { Hono } from 'hono';
import { serve } from 'bun';
import { ClaudeTerminal, type Model } from './terminal';
import { sendWhatsApp, sendWhatsAppImage, sendModelSelector, sendCommandsList } from './whatsapp';

const config = {
  port: parseInt(process.env.PORT || '3000'),
  kapsoWebhookSecret: process.env.KAPSO_WEBHOOK_SECRET!,
  userPhone: process.env.USER_PHONE_NUMBER!,
};

const terminal = new ClaudeTerminal();
const app = new Hono();

// Store pending prompts waiting for model selection
const pendingPrompts = new Map<string, { text: string; messageId?: string }>();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Kapso webhook verification
app.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token === config.kapsoWebhookSecret) {
    console.log('Webhook verified');
    return c.text(challenge || '');
  }
  return c.text('Forbidden', 403);
});

// Kapso webhook handler
app.post('/webhook', async (c) => {
  const payload = await c.req.json();

  // Extract message from Kapso payload
  const message = extractMessage(payload);
  if (!message) return c.json({ status: 'ignored' });

  // Only accept messages from configured user
  const normalizedPhone = config.userPhone.replace('+', '');
  if (!message.from.endsWith(normalizedPhone)) {
    console.log(`Ignored message from ${message.from}`);
    return c.json({ status: 'ignored' });
  }

  const t0 = Date.now();

  // Check if this is a list reply (command selection)
  if (message.type === 'list' && message.listId) {
    console.log(`> Command: ${message.listId}`);

    if (message.listId === 'cmd_reset') {
      terminal.clearSession(message.from);
      await sendWhatsApp(message.from, 'Sessao limpa. Proximo prompt inicia conversa nova.');
      return c.json({ status: 'reset' });
    }

    if (message.listId === 'cmd_compact') {
      pendingPrompts.set(message.from, { text: '/compact', messageId: message.messageId });
      await sendModelSelector(message.from, message.messageId);
      return c.json({ status: 'awaiting_model' });
    }

    if (message.listId === 'cmd_help') {
      await sendWhatsApp(message.from,
        'Claude Terminal - Comandos:\n\n' +
        '/ - Lista de comandos\n' +
        '/reset - Limpar sessao\n' +
        '/compact - Compactar contexto\n\n' +
        'Envie qualquer mensagem para interagir com o Claude.'
      );
      return c.json({ status: 'help' });
    }

    return c.json({ status: 'unknown_command' });
  }

  // Check if this is a button reply (model selection)
  if (message.type === 'button' && message.buttonId) {
    const pending = pendingPrompts.get(message.from);

    if (!pending) {
      await sendWhatsApp(message.from, 'Nenhum prompt pendente. Envie uma mensagem primeiro.');
      return c.json({ status: 'no_pending' });
    }

    // Determine model from button ID
    const model: Model = message.buttonId.startsWith('model_opus') ? 'opus' : 'haiku';
    console.log(`> [${model}] ${pending.text}`);

    // Clear pending prompt
    pendingPrompts.delete(message.from);

    // Send processing indicator
    sendWhatsApp(message.from, `Processando com ${model}...`);

    // Process with selected model (pass phone as userId for session persistence)
    const t1 = Date.now();
    const result = await terminal.send(pending.text, model, message.from);
    const t2 = Date.now();
    console.log(`[timing] Claude (${model}): ${t2 - t1}ms`);

    // Send images first (if any)
    for (const imageUrl of result.images) {
      await sendWhatsAppImage(message.from, imageUrl);
      console.log(`[timing] Image sent`);
    }

    // Send text response
    if (result.text) {
      await sendWhatsApp(message.from, result.text);
      console.log(`[timing] Total: ${Date.now() - t0}ms`);
    }

    return c.json({ status: 'ok' });
  }

  // Regular text message - store and show model selector
  if (message.type === 'text' && message.text) {
    console.log(`> ${message.text}`);

    // Handle "/" to show commands list
    if (message.text === '/') {
      await sendCommandsList(message.from);
      return c.json({ status: 'commands_list' });
    }

    // Handle /reset command to clear session
    if (message.text.toLowerCase() === '/reset') {
      terminal.clearSession(message.from);
      await sendWhatsApp(message.from, 'Sessao limpa. Proximo prompt inicia conversa nova.');
      return c.json({ status: 'reset' });
    }

    // Handle /compact command
    if (message.text.toLowerCase() === '/compact') {
      pendingPrompts.set(message.from, { text: '/compact', messageId: message.messageId });
      await sendModelSelector(message.from, message.messageId);
      return c.json({ status: 'awaiting_model' });
    }

    // Store the prompt with message ID
    pendingPrompts.set(message.from, { text: message.text, messageId: message.messageId });

    // Send model selector (replies to original message if supported)
    await sendModelSelector(message.from, message.messageId);
    console.log(`[timing] Model selector sent: ${Date.now() - t0}ms`);

    return c.json({ status: 'awaiting_model' });
  }

  return c.json({ status: 'ignored' });
});

type ExtractedMessage = {
  from: string;
  type: 'text' | 'button' | 'list';
  text?: string;
  buttonId?: string;
  listId?: string;
  messageId?: string;
};

function extractMessage(payload: any): ExtractedMessage | null {
  try {
    // Kapso v2 format
    if (payload?.message && payload?.conversation) {
      const message = payload.message;
      const conversation = payload.conversation;
      const from = conversation.phone_number?.replace('+', '') || '';

      // Button reply
      if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        return {
          from,
          type: 'button',
          buttonId: message.interactive.button_reply?.id || '',
        };
      }

      // List reply
      if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
        return {
          from,
          type: 'list',
          listId: message.interactive.list_reply?.id || '',
        };
      }

      // Text message
      if (message.type === 'text') {
        return {
          from,
          type: 'text',
          text: message.kapso?.content || message.text?.body || '',
          messageId: message.id,
        };
      }
    }

    // Fallback: Meta format (legacy)
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) return null;

    const from = message.from;

    // Button reply (Meta format)
    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      return {
        from,
        type: 'button',
        buttonId: message.interactive.button_reply?.id || '',
      };
    }

    // List reply (Meta format)
    if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
      return {
        from,
        type: 'list',
        listId: message.interactive.list_reply?.id || '',
      };
    }

    // Text message
    if (message.type === 'text') {
      return {
        from,
        type: 'text',
        text: message.text?.body || '',
        messageId: message.id,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Start server
console.log(`Claude Terminal starting on port ${config.port}...`);
serve({ fetch: app.fetch, port: config.port });
console.log(`Ready! Webhook: http://localhost:${config.port}/webhook`);
console.log(`Use: tailscale funnel ${config.port}`);
