// src/telegram.ts
/**
 * Telegram Bot API integration for Dojo mode
 *
 * Handles:
 * - Bot initialization
 * - Message sending
 * - Webhook processing
 */

import TelegramBot from 'node-telegram-bot-api';

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Lazy initialization - bot is only created when needed
let bot: TelegramBot | null = null;

/**
 * Get or create the Telegram bot instance
 */
export function getTelegramBot(): TelegramBot | null {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN not set - Telegram features disabled');
    return null;
  }

  if (!bot) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
  }

  return bot;
}

/**
 * Check if Telegram is configured
 */
export function isTelegramConfigured(): boolean {
  return !!TELEGRAM_BOT_TOKEN;
}

/**
 * Send a text message to a Telegram chat
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...options,
    });
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return null;
  }
}

/**
 * Send a document to a Telegram chat
 */
export async function sendTelegramDocument(
  chatId: number | string,
  document: Buffer | string,
  filename: string,
  caption?: string
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendDocument(chatId, document, {
      caption,
    }, {
      filename,
    });
  } catch (error) {
    console.error('Failed to send Telegram document:', error);
    return null;
  }
}

/**
 * Send a photo to a Telegram chat
 */
export async function sendTelegramPhoto(
  chatId: number | string,
  photo: Buffer | string,
  caption?: string
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendPhoto(chatId, photo, { caption });
  } catch (error) {
    console.error('Failed to send Telegram photo:', error);
    return null;
  }
}

/**
 * Send an inline keyboard with buttons
 */
export async function sendTelegramButtons(
  chatId: number | string,
  text: string,
  buttons: Array<{ text: string; callback_data: string }[]>
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    console.error('Failed to send Telegram buttons:', error);
    return null;
  }
}

/**
 * Answer a callback query (button press)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    return await telegramBot.answerCallbackQuery(callbackQueryId, { text });
  } catch (error) {
    console.error('Failed to answer callback query:', error);
    return false;
  }
}

/**
 * Get bot info
 */
export async function getBotInfo(): Promise<TelegramBot.User | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.getMe();
  } catch (error) {
    console.error('Failed to get bot info:', error);
    return null;
  }
}

/**
 * Set webhook URL for the bot
 */
export async function setTelegramWebhook(url: string): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    return await telegramBot.setWebHook(url);
  } catch (error) {
    console.error('Failed to set Telegram webhook:', error);
    return false;
  }
}
