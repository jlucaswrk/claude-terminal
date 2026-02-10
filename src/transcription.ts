/**
 * Audio transcription using OpenAI Whisper API
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
}

/**
 * Transcribe audio using OpenAI Whisper API
 * @param buffer - Audio file buffer (supports mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg)
 * @param mimeType - MIME type of the audio file
 * @returns Transcription result with text or error
 */
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string
): Promise<TranscriptionResult> {
  try {
    // Map MIME type to file extension for the API
    const extensionMap: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/opus': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/mp4': 'mp4',
      'audio/m4a': 'm4a',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
      'audio/x-wav': 'wav',
    };

    const extension = extensionMap[mimeType] || 'ogg';
    const filename = `audio.${extension}`;

    // Create form data
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt'); // Fixed Portuguese as per design

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Whisper API error:', errorText);
      return {
        success: false,
        error: `API error: ${response.status}`,
      };
    }

    const data = await response.json() as { text: string };
    const text = data.text?.trim();

    if (!text) {
      return {
        success: false,
        error: 'Transcrição vazia',
      };
    }

    return {
      success: true,
      text,
    };
  } catch (error) {
    console.error('Transcription error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
}
