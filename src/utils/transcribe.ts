/**
 * Audio transcription utility using OpenAI Whisper API
 */

import OpenAI, { toFile } from 'openai';
import { SettingsManager } from '../settings';

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
  duration?: number;
}

/**
 * Transcribe audio buffer using OpenAI Whisper API
 */
export async function transcribeAudio(
  buffer: Buffer,
  format: string,
  language?: string
): Promise<TranscriptionResult> {
  const apiKey = SettingsManager.get('openai.apiKey');

  if (!apiKey) {
    return {
      success: false,
      error:
        'OpenAI API key not configured. Add your OpenAI key in Settings to enable voice notes.',
    };
  }

  try {
    const openai = new OpenAI({ apiKey });

    // Create an Uploadable from the buffer using the OpenAI SDK helper
    // OpenAI accepts: mp3, mp4, mpeg, mpga, m4a, wav, webm, ogg
    const mimeType = getMimeType(format);
    const file = await toFile(buffer, `audio.${format}`, { type: mimeType });

    const startTime = Date.now();

    const response = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language, // Optional: helps with accuracy if language is known
    });

    const duration = (Date.now() - startTime) / 1000;

    return {
      success: true,
      text: response.text,
      duration,
    };
  } catch (error) {
    console.error('[Transcribe] Error:', error);

    // Handle specific OpenAI errors
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401) {
        return {
          success: false,
          error: 'Invalid OpenAI API key. Please check your key in Settings.',
        };
      }
      if (error.status === 429) {
        return {
          success: false,
          error: 'OpenAI rate limit exceeded. Please try again in a moment.',
        };
      }
      return {
        success: false,
        error: `OpenAI API error: ${error.message}`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown transcription error',
    };
  }
}

/**
 * Check if voice transcription is available (OpenAI key configured)
 */
export function isTranscriptionAvailable(): boolean {
  return !!SettingsManager.get('openai.apiKey');
}

/**
 * Get MIME type for audio format
 */
function getMimeType(format: string): string {
  const mimeTypes: Record<string, string> = {
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    wav: 'audio/wav',
    webm: 'audio/webm',
    mpeg: 'audio/mpeg',
    mpga: 'audio/mpeg',
  };
  return mimeTypes[format.toLowerCase()] || 'audio/ogg';
}
