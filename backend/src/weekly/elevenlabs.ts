/**
 * The only module that talks to ElevenLabs.
 *
 * Plain `fetch` instead of the SDK: the pilot needs two endpoints and the response headers (the
 * request id that conditions the next chunk, and the character cost), and that is simpler to
 * read here than through a client wrapper. Swap for `@elevenlabs/elevenlabs-js` if the job grows.
 */

const API = "https://api.elevenlabs.io";

export const ELEVEN_MODEL = "eleven_v4";

export interface DialogueInput {
  text: string;
  voice_id: string;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface VoiceSegment {
  voice_id: string;
  start_time_seconds: number;
  end_time_seconds: number;
  character_start_index: number;
  character_end_index: number;
  dialogue_input_index: number;
}

export interface DialogueResult {
  audio: Buffer;
  alignment: Alignment | null;
  normalizedAlignment: Alignment | null;
  voiceSegments: VoiceSegment[];
  requestId: string | null;
  /** Billed characters as reported by the provider, when the header is present. */
  characterCost: number | null;
  headers: Record<string, string>;
}

/** Eleven v4 exposes two voice settings; style and speed are not available on v4. */
export interface DialogueSettings {
  /** 0–1, default 0.5. Lower widens the emotional range at the cost of consistency. */
  stability?: number;
  /** 0–1, default 0.75. Higher sticks closer to the reference voice. */
  similarity?: number;
}

export interface DialogueRequest {
  inputs: DialogueInput[];
  seed?: number;
  settings?: DialogueSettings;
  previousRequestIds?: string[];
  previousText?: string;
  futureText?: string;
}

export class ElevenLabsClient {
  constructor(private readonly apiKey: string) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      // The body explains the failure (quota, voice access, validation); the key never appears in it.
      throw new Error(`ElevenLabs ${path} → ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    return response;
  }

  /** Free call: how many characters the plan has used and allows. */
  async subscription(): Promise<{ used: number; limit: number; tier: string }> {
    const data = (await (await this.call("/v1/user/subscription")).json()) as {
      character_count: number;
      character_limit: number;
      tier: string;
    };
    return { used: data.character_count, limit: data.character_limit, tier: data.tier };
  }

  async dialogue(request: DialogueRequest): Promise<DialogueResult> {
    const body = {
      inputs: request.inputs,
      model_id: ELEVEN_MODEL,
      language_code: "pt",
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      ...(request.settings ? { settings: request.settings } : {}),
      // The API accepts one form of backward context, not both; request ids carry the actual audio.
      ...(request.previousRequestIds?.length
        ? { previous_request_ids: request.previousRequestIds.slice(-3) }
        : request.previousText
          ? { previous_text: request.previousText.slice(-100) }
          : {}),
      ...(request.futureText ? { future_text: request.futureText.slice(0, 100) } : {}),
    };
    const response = await this.call("/v1/text-to-dialogue/with-timestamps?output_format=mp3_44100_128", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (/request-id|character|cost|x-/.test(key)) headers[key] = value;
    });
    const data = (await response.json()) as {
      audio_base64: string;
      alignment?: Alignment | null;
      normalized_alignment?: Alignment | null;
      voice_segments?: VoiceSegment[];
    };
    const cost = headers["x-character-count"] ?? headers["character-cost"] ?? null;
    return {
      audio: Buffer.from(data.audio_base64, "base64"),
      alignment: data.alignment ?? null,
      normalizedAlignment: data.normalized_alignment ?? null,
      voiceSegments: data.voice_segments ?? [],
      requestId: headers["request-id"] ?? headers["x-request-id"] ?? null,
      characterCost: cost !== null && Number.isFinite(Number(cost)) ? Number(cost) : null,
      headers,
    };
  }
}
