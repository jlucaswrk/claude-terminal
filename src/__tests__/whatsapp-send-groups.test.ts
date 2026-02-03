import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

describe('WhatsApp send to groups', () => {
  beforeEach(() => {
    globalThis.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  it('should send text to group with recipient_type group', async () => {
    const { sendWhatsApp } = await import('../whatsapp');

    // Group ID format: ends with @g.us
    await sendWhatsApp('120363123456789012@g.us', 'Hello group!');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
    expect(body.to).toBe('120363123456789012@g.us');
  });

  it('should send text to individual with recipient_type individual', async () => {
    const { sendWhatsApp } = await import('../whatsapp');

    await sendWhatsApp('5581999999999', 'Hello!');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('individual');
  });

  it('should send image to group with recipient_type group', async () => {
    const { sendWhatsAppImage } = await import('../whatsapp');

    await sendWhatsAppImage('120363123456789012@g.us', 'media123', 'caption');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
  });

  it('should send document to group with recipient_type group', async () => {
    const { sendWhatsAppDocument } = await import('../whatsapp');

    await sendWhatsAppDocument('120363123456789012@g.us', 'media123', 'file.pdf');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
  });

  it('should send media to group with recipient_type group', async () => {
    const { sendWhatsAppMedia } = await import('../whatsapp');

    await sendWhatsAppMedia('120363123456789012@g.us', 'media123', 'video');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
  });

  it('should send buttons to group with recipient_type group', async () => {
    const { sendButtons } = await import('../whatsapp');

    await sendButtons('120363123456789012@g.us', 'Message', [{ id: 'btn1', title: 'Button' }]);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
  });

  it('should send confirmation to group with recipient_type group', async () => {
    const { sendConfirmation } = await import('../whatsapp');

    await sendConfirmation('120363123456789012@g.us', 'Confirm?', [{ id: 'yes', title: 'Yes' }]);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('group');
  });

  it('should handle individual phone numbers correctly', async () => {
    const { sendWhatsAppImage } = await import('../whatsapp');

    await sendWhatsAppImage('+5581999999999', 'media123');

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.recipient_type).toBe('individual');
  });
});
