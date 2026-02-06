import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock fetch globally
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  })
);

// Store original fetch
const originalFetch = global.fetch;

describe('WhatsApp UI for groups flow', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should send agent mode selector', async () => {
    const { sendAgentModeSelector } = await import('../whatsapp');

    await sendAgentModeSelector('user1');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.interactive.body.text).toContain('Conversacional');
    expect(body.interactive.body.text).toContain('Ralph');
  });

  it('should send model mode selector', async () => {
    const { sendModelModeSelector } = await import('../whatsapp');

    await sendModelModeSelector('user1');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.interactive.body.text).toContain('Seleção');
  });

  it('should send delete group choice', async () => {
    const { sendDeleteGroupChoice } = await import('../whatsapp');

    await sendDeleteGroupChoice('user1', 'Backend API');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.interactive.body.text.toLowerCase()).toContain('deletar');
    expect(body.interactive.body.text).toContain('Backend API');
  });

  it('should send reject prompt message', async () => {
    const { sendRejectPrompt } = await import('../whatsapp');

    await sendRejectPrompt('user1');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.text.body).toContain('grupo do agente');
  });

  it('should send unlinked group message', async () => {
    const { sendUnlinkedGroupMessage } = await import('../whatsapp');

    await sendUnlinkedGroupMessage('group123@g.us');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.text.body).toContain('não vinculado');
  });
});
