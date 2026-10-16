// Google Cloud Text-to-Speech API integration for Indonesian (id-ID)
// Reference: https://docs.cloud.google.com/text-to-speech/docs/reference/rest?apix=true

const TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const audioCache = new Map<string, string>();
let currentAudio: HTMLAudioElement | null = null;

export type TtsSource = 'google' | 'browser';

export interface TtsPlayResult {
  success: boolean;
  source: TtsSource;
  error?: string;
}

/**
 * Normalizes text for speech (drops punctuation, trims).
 */
export function cleanSpeechText(text: string): string {
  return text.replace(/[.,/#!$%^&*;:{}=\-_`~()?"'“”]/g, '').trim();
}

/**
 * Returns the Google Cloud TTS API key from Vite environment if available.
 */
export function getGoogleTtsApiKey(): string | undefined {
  return (import.meta.env.VITE_GOOGLE_TTS_API_KEY as string | undefined)?.trim();
}

/**
 * Stops any currently playing audio.
 */
export function stopSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Synthesizes and plays Indonesian pronunciation using Google Cloud Text-to-Speech REST API.
 * Falls back to browser Web Speech Synthesis if API key is absent or request fails.
 */
export async function playIndonesianSpeech(rawText: string, onEnded?: () => void): Promise<TtsPlayResult> {
  const text = cleanSpeechText(rawText);
  if (!text) {
    return { success: false, source: 'browser', error: 'Teks kosong' };
  }

  stopSpeech();

  const apiKey = getGoogleTtsApiKey();

  // 1. Try Google Cloud Text-to-Speech REST API when key is configured
  if (apiKey) {
    try {
      const cachedUrl = audioCache.get(text.toLowerCase());
      if (cachedUrl) {
        void playAudioUrl(cachedUrl).then(onEnded).catch(() => onEnded?.());
        return { success: true, source: 'google' };
      }

      const response = await fetch(`${TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'id-ID',
            name: 'id-ID-Neural2-A',
            ssmlGender: 'FEMALE',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.92,
            pitch: 0.0,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Google TTS] HTTP ${response.status}: ${errText}`);
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as { audioContent?: string };
      if (data.audioContent) {
        const blobUrl = base64ToBlobUrl(data.audioContent, 'audio/mp3');
        audioCache.set(text.toLowerCase(), blobUrl);
        void playAudioUrl(blobUrl).then(onEnded).catch(() => onEnded?.());
        return { success: true, source: 'google' };
      }
    } catch (err) {
      console.warn('[Google TTS] Gagal memanggil API Google TTS, beralih ke suara peramban:', err);
    }
  }

  // 2. Fallback to Browser SpeechSynthesis (Web Speech API)
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'id-ID';
      utterance.rate = 0.9;

      // Pick Indonesian voice if browser lists one
      const voices = window.speechSynthesis.getVoices();
      const idVoice = voices.find((v) => v.lang.startsWith('id') || v.lang.replace('_', '-').includes('id-ID'));
      if (idVoice) utterance.voice = idVoice;

      utterance.onend = () => {
        onEnded?.();
        resolve({ success: true, source: 'browser' });
      };
      utterance.onerror = (e) => {
        console.warn('[Browser TTS error]', e);
        onEnded?.();
        resolve({ success: false, source: 'browser', error: 'Gagal memutar suara di peramban' });
      };

      window.speechSynthesis.speak(utterance);
    });
  }

  return {
    success: false,
    source: 'browser',
    error: 'Peramban tidak mendukung pemutaran suara',
  };
}

function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

function playAudioUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => {
      currentAudio = null;
      resolve();
    };
    audio.onerror = (e) => {
      currentAudio = null;
      reject(e);
    };
    audio.play().catch(reject);
  });
}
