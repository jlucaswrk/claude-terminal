import { describe, it, expect } from 'bun:test';
import { extractMessage } from '../index';

describe('extractMessage with groups', () => {
  it('should extract groupId from group message', () => {
    const payload = {
      message: {
        type: 'text',
        text: { body: 'Hello' },
        id: 'msg123',
        kapso: { content: 'Hello' },
      },
      conversation: {
        phone_number: '+5581999999999',
        group_id: '120363123456789012@g.us',
      },
    };

    const result = extractMessage(payload);
    expect(result?.groupId).toBe('120363123456789012@g.us');
    expect(result?.from).toBe('5581999999999');
  });

  it('should not have groupId for individual messages', () => {
    const payload = {
      message: {
        type: 'text',
        text: { body: 'Hello' },
        id: 'msg123',
        kapso: { content: 'Hello' },
      },
      conversation: {
        phone_number: '+5581999999999',
      },
    };

    const result = extractMessage(payload);
    expect(result?.groupId).toBeUndefined();
    expect(result?.from).toBe('5581999999999');
  });

  it('should extract groupId from button reply in group', () => {
    const payload = {
      message: {
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'btn_123' },
        },
      },
      conversation: {
        phone_number: '+5581999999999',
        group_id: '120363123456789012@g.us',
      },
    };

    const result = extractMessage(payload);
    expect(result?.type).toBe('button');
    expect(result?.buttonId).toBe('btn_123');
    expect(result?.groupId).toBe('120363123456789012@g.us');
  });

  it('should extract groupId from list reply in group', () => {
    const payload = {
      message: {
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: { id: 'list_123' },
        },
      },
      conversation: {
        phone_number: '+5581999999999',
        group_id: '120363123456789012@g.us',
      },
    };

    const result = extractMessage(payload);
    expect(result?.type).toBe('list');
    expect(result?.listId).toBe('list_123');
    expect(result?.groupId).toBe('120363123456789012@g.us');
  });

  it('should extract groupId from image message in group', () => {
    const payload = {
      message: {
        type: 'image',
        image: {
          id: 'img123',
          mime_type: 'image/jpeg',
          caption: 'Test image',
        },
        kapso: { media_url: 'https://example.com/img.jpg' },
        id: 'msg123',
      },
      conversation: {
        phone_number: '+5581999999999',
        group_id: '120363123456789012@g.us',
      },
    };

    const result = extractMessage(payload);
    expect(result?.type).toBe('image');
    expect(result?.imageId).toBe('img123');
    expect(result?.groupId).toBe('120363123456789012@g.us');
  });

  it('should extract groupId from audio message in group', () => {
    const payload = {
      message: {
        type: 'audio',
        audio: {
          id: 'audio123',
          mime_type: 'audio/ogg',
        },
        kapso: { media_url: 'https://example.com/audio.ogg' },
        id: 'msg123',
      },
      conversation: {
        phone_number: '+5581999999999',
        group_id: '120363123456789012@g.us',
      },
    };

    const result = extractMessage(payload);
    expect(result?.type).toBe('audio');
    expect(result?.audioId).toBe('audio123');
    expect(result?.groupId).toBe('120363123456789012@g.us');
  });
});
