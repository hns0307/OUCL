export const MAX_GRADIENT_CHARACTERS = 256;
const MAX_GRADIENT_CODE_UNITS = 4096;

export interface GradientCharacter { text: string; color: string }
export type GradientResult = { ok: true; characters: GradientCharacter[]; json: string }
  | { ok: false; error: 'empty' | 'tooLong' | 'invalidColor' | 'invalidText' };

function channels(color: string): [number, number, number] {
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}

/**
 * Produce bounded, escaped Java 1.16+ JSON text components without executing input.
 * Unicode graphemes (including joined emoji) receive one color; endpoints are exact.
 */
export function createGradientText(text: string, start: string, end: string): GradientResult {
  if (!/^#[0-9a-f]{6}$/i.test(start) || !/^#[0-9a-f]{6}$/i.test(end)) return { ok: false, error: 'invalidColor' };
  if (!text.length) return { ok: false, error: 'empty' };
  if (text.length > MAX_GRADIENT_CODE_UNITS) return { ok: false, error: 'tooLong' };
  if (Array.from(text).some(value => {
    const code = value.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10) || code === 127;
  })) return { ok: false, error: 'invalidText' };
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), item => item.segment);
  if (graphemes.length > MAX_GRADIENT_CHARACTERS) return { ok: false, error: 'tooLong' };
  const from = channels(start); const to = channels(end);
  const characters = graphemes.map((value, index) => {
    const fraction = graphemes.length === 1 ? 0 : index / (graphemes.length - 1);
    const color = '#' + from.map((channel, offset) => Math.round(channel + (to[offset]! - channel) * fraction).toString(16).padStart(2, '0')).join('');
    return { text: value, color };
  });
  return { ok: true, characters, json: JSON.stringify({ text: '', extra: characters }) };
}
