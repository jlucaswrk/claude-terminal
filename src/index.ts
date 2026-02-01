import { Hono } from 'hono';
import { serve } from 'bun';
import { ClaudeTerminal } from './terminal';
import { sendWhatsApp } from './whatsapp';

const config = {
  port: parseInt(process.env.PORT || '3000'),
  kapsoWebhookSecret: process.env.KAPSO_WEBHOOK_SECRET!,
  userPhone: process.env.USER_PHONE_NUMBER!,
};

const terminal = new ClaudeTerminal();
const app = new Hono();

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

  console.log(`> ${message.text}`);

  // Send to Claude terminal
  const output = await terminal.send(message.text);

  // Send response back via WhatsApp
  if (output) {
    await sendWhatsApp(message.from, output);
  }

  return c.json({ status: 'ok' });
});

function extractMessage(payload: any): { from: string; text: string } | null {
  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message || message.type !== 'text') return null;

    return {
      from: message.from,
      text: message.text?.body || ''
    };
  } catch {
    return null;
  }
}

// Start server
console.log(`Claude Terminal starting on port ${config.port}...`);
serve({ fetch: app.fetch, port: config.port });
console.log(`Ready! Webhook: http://localhost:${config.port}/webhook`);
console.log(`Use: tailscale funnel ${config.port}`);
