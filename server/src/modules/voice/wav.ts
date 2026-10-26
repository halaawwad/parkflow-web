/**
 * Minimal WAV handling for the navigation voice: read the PCM out of a WAV
 * file, trim the silence the model pads around a sentence, and wrap PCM back
 * into a WAV every browser plays. Mono 16-bit PCM only — what Gemini returns.
 */

export interface Pcm {
  pcm: Buffer;
  sampleRate: number;
}

/** Wraps mono 16-bit little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * The PCM inside a WAV file, or undefined when it is not mono 16-bit PCM.
 * Other chunks (e.g. Gemini's C2PA provenance block) are skipped.
 */
export function wavToPcm(wav: Buffer): Pcm | undefined {
  if (wav.length < 12 || wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') return undefined;
  let offset = 12;
  let sampleRate: number | undefined;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('latin1', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = wav.readUInt16LE(body);
      const channels = wav.readUInt16LE(body + 2);
      const bits = wav.readUInt16LE(body + 14);
      if (format !== 1 || channels !== 1 || bits !== 16) return undefined;
      sampleRate = wav.readUInt32LE(body + 4);
    } else if (id === 'data' && sampleRate) {
      return { pcm: wav.subarray(body, Math.min(wav.length, body + size)), sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return undefined;
}

/** Below this level (about -40 dBFS) a sample counts as silence. */
const SILENCE = 330;
/** Breathing room kept around the speech so words are never clipped. */
const PAD_MS = 90;

/**
 * Removes leading and trailing silence. A prompt that starts the moment it is
 * due sounds attentive; seconds of dead air before "turn left" sound broken.
 * Audio with no sample above the threshold is returned unchanged.
 */
export function trimSilence({ pcm, sampleRate }: Pcm): Pcm {
  const samples = Math.floor(pcm.length / 2);
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples; i++) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > SILENCE) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { pcm, sampleRate };
  const pad = Math.round((sampleRate * PAD_MS) / 1000);
  const start = Math.max(0, first - pad);
  const end = Math.min(samples, last + 1 + pad);
  return { pcm: pcm.subarray(start * 2, end * 2), sampleRate };
}
