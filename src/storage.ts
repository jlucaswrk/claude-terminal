const KAPSO_API_KEY = process.env.KAPSO_API_KEY!;
const KAPSO_PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID!;

/**
 * Upload an image to Kapso Media Storage and return the media_id
 */
export async function uploadImageToKapso(
  buffer: Buffer,
  filename: string,
  mimeType: string = 'image/png'
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
  console.log(`Uploaded to Kapso: ${data.id}`);
  return data.id;
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
