import { readFileSync, existsSync } from 'fs';
import { basename, extname } from 'path';

const KAPSO_API_KEY = process.env.KAPSO_API_KEY!;
const KAPSO_PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID!;

// MIME type mapping for common file extensions
// Note: WhatsApp only accepts specific types. CSV, JSON, XML are sent as text/plain
const MIME_TYPES: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/plain',   // WhatsApp doesn't accept text/csv
  '.txt': 'text/plain',
  '.json': 'text/plain',  // WhatsApp doesn't accept application/json
  '.xml': 'text/plain',   // WhatsApp doesn't accept application/xml
  '.zip': 'application/zip',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Get MIME type from file extension
 */
export function getMimeType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Determine WhatsApp media type from MIME type
 */
export function getWhatsAppMediaType(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Upload a file to Kapso Media Storage and return the media_id
 */
export async function uploadToKapso(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);
  formData.append('messaging_product', 'whatsapp');

  const response = await fetch(
    `https://api.kapso.ai/meta/whatsapp/v24.0/${KAPSO_PHONE_NUMBER_ID}/media`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': KAPSO_API_KEY,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Kapso upload failed: ${error}`);
  }

  const data = await response.json();
  console.log(`Uploaded to Kapso: ${data.id} (${mimeType})`);
  return data.id;
}

/**
 * Upload a file from filesystem to Kapso
 */
export async function uploadFileToKapso(filePath: string): Promise<{ mediaId: string; filename: string; mimeType: string }> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const buffer = readFileSync(filePath);
  const filename = basename(filePath);
  const mimeType = getMimeType(filename);
  const mediaId = await uploadToKapso(buffer, filename, mimeType);

  return { mediaId, filename, mimeType };
}

/**
 * Upload an image to Kapso Media Storage and return the media_id
 * @deprecated Use uploadToKapso instead
 */
export async function uploadImageToKapso(
  buffer: Buffer,
  filename: string,
  mimeType: string = 'image/png'
): Promise<string> {
  return uploadToKapso(buffer, filename, mimeType);
}

/**
 * Upload a base64 encoded image to Kapso
 */
export async function uploadBase64Image(
  base64Data: string,
  filename: string
): Promise<string> {
  // Remove data URL prefix if present
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Clean, 'base64');

  // Detect content type from base64 prefix or default to png
  let mimeType = 'image/png';
  if (base64Data.startsWith('data:image/jpeg')) mimeType = 'image/jpeg';
  else if (base64Data.startsWith('data:image/gif')) mimeType = 'image/gif';
  else if (base64Data.startsWith('data:image/webp')) mimeType = 'image/webp';

  return uploadImageToKapso(buffer, filename, mimeType);
}
