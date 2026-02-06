import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// Mock fetch globally
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ id: '120363123456789012@g.us' }),
    text: () => Promise.resolve(''),
  })
);

// Store original fetch
const originalFetch = global.fetch;

describe('WhatsApp Groups API', () => {
  beforeEach(() => {
    global.fetch = mockFetch as any;
    mockFetch.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should create a group with correct payload', async () => {
    const { createWhatsAppGroup } = await import('../whatsapp');

    const groupId = await createWhatsAppGroup(
      'Backend API',
      '📁 /Users/lucas/projects/api\n📅 03/02/2026\n💬 Conversacional',
      '+5581999999999'
    );

    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/groups');

    const body = JSON.parse(options.body);
    expect(body.subject).toBe('Backend API');
    expect(body.description).toContain('Conversacional');
  });

  it('should return the group ID from API response', async () => {
    const { createWhatsAppGroup } = await import('../whatsapp');

    const groupId = await createWhatsAppGroup(
      'Test Agent',
      'Test description',
      '+5581999999999'
    );

    expect(groupId).toBe('120363123456789012@g.us');
  });

  it('should add user as participant after creating group', async () => {
    const { createWhatsAppGroup } = await import('../whatsapp');

    await createWhatsAppGroup(
      'Test Agent',
      'Test description',
      '+5581999999999'
    );

    // Should have 2 fetch calls: create group + add participant
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [participantUrl, participantOptions] = mockFetch.mock.calls[1];
    expect(participantUrl).toContain('/groups/');
    expect(participantUrl).toContain('/participants');

    const body = JSON.parse(participantOptions.body);
    expect(body.participants).toContain('5581999999999'); // Without +
  });

  it('should throw error when group creation fails', async () => {
    const failingFetch = mock(() =>
      Promise.resolve({
        ok: false,
        text: () => Promise.resolve('API Error: Invalid request'),
      })
    );
    global.fetch = failingFetch as any;

    const { createWhatsAppGroup } = await import('../whatsapp');

    await expect(
      createWhatsAppGroup('Test', 'Desc', '+5581999999999')
    ).rejects.toThrow('Failed to create WhatsApp group');
  });

  it('should still return group ID if adding participant fails', async () => {
    let callCount = 0;
    const partialFailFetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        // Group creation succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: '120363999888777666@g.us' }),
        });
      } else {
        // Adding participant fails
        return Promise.resolve({
          ok: false,
          text: () => Promise.resolve('Participant error'),
        });
      }
    });
    global.fetch = partialFailFetch as any;

    const { createWhatsAppGroup } = await import('../whatsapp');

    const groupId = await createWhatsAppGroup(
      'Test',
      'Desc',
      '+5581999999999'
    );

    // Should still return the group ID even if participant addition fails
    expect(groupId).toBe('120363999888777666@g.us');
  });

  it('should delete a group', async () => {
    const { deleteWhatsAppGroup } = await import('../whatsapp');

    await deleteWhatsAppGroup('120363123456789012@g.us');

    expect(mockFetch).toHaveBeenCalled();
    const [url, options] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(url).toContain('/groups/120363123456789012@g.us');
    expect(options.method).toBe('DELETE');
  });
});
