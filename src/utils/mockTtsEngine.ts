import type { ScreenplayScene } from '../types/studio.ts';
import { buildBeatKey } from './screenplayReader.ts';

export type MockTtsVoiceId =
  | 'narrator-baritone'
  | 'actor-warm'
  | 'alto-crisp'
  | 'trailer-epic'
  | 'director-scratch';

export type MockTtsEmotion = 'neutral' | 'dramatic' | 'urgent' | 'whisper';

export interface MockTtsVoiceProfile {
  id: MockTtsVoiceId;
  label: string;
  register: string;
  basePitchHz: number;
  formantShift: number;
  webSpeechPitch: number;
}

export const MOCK_TTS_VOICES: MockTtsVoiceProfile[] = [
  {
    id: 'narrator-baritone',
    label: 'Narrador Barítono',
    register: 'Grave · Documental / Épico',
    basePitchHz: 112,
    formantShift: 0.92,
    webSpeechPitch: 0.85,
  },
  {
    id: 'actor-warm',
    label: 'Protagonista Cálido',
    register: 'Tenor · Intimista',
    basePitchHz: 142,
    formantShift: 1.0,
    webSpeechPitch: 1.0,
  },
  {
    id: 'alto-crisp',
    label: 'Actriz Contralto',
    register: 'Medio-Agudo · Preciso',
    basePitchHz: 196,
    formantShift: 1.16,
    webSpeechPitch: 1.15,
  },
  {
    id: 'trailer-epic',
    label: 'Locutor Tráiler',
    register: 'Sub-grave · Cinemático',
    basePitchHz: 96,
    formantShift: 0.86,
    webSpeechPitch: 0.78,
  },
  {
    id: 'director-scratch',
    label: 'Guía de Ritmo (Director)',
    register: 'Neutro · Lectura de mesa',
    basePitchHz: 158,
    formantShift: 1.04,
    webSpeechPitch: 1.02,
  },
];

export const MOCK_TTS_EMOTIONS: Array<{
  id: MockTtsEmotion;
  label: string;
  energy: number;
  vibratoDepth: number;
}> = [
  { id: 'neutral', label: 'Natural', energy: 0.78, vibratoDepth: 0.015 },
  { id: 'dramatic', label: 'Dramático', energy: 0.92, vibratoDepth: 0.032 },
  { id: 'urgent', label: 'Urgente', energy: 0.96, vibratoDepth: 0.024 },
  { id: 'whisper', label: 'Susurro / Íntimo', energy: 0.48, vibratoDepth: 0.01 },
];

export interface ScriptBeatOption {
  beatKey: string;
  sceneIndex: number;
  sceneNumber: string;
  slugline: string;
  beatIndex: number;
  beatType: 'action' | 'dialogue' | 'camera' | 'sound';
  character?: string;
  parenthetical?: string;
  text: string;
}

export interface MockVoiceoverClip {
  id: string;
  beatKey: string;
  sceneNumber: string;
  beatType: 'action' | 'dialogue' | 'camera' | 'sound';
  character?: string;
  text: string;
  voiceId: MockTtsVoiceId;
  voiceLabel: string;
  emotion: MockTtsEmotion;
  rate: number;
  pitchSemitones: number;
  durationSec: number;
  waveform: number[];
  audioUrl: string;
  createdAt: string;
}

export function extractScriptBeatOptions(scenes: ScreenplayScene[]): ScriptBeatOption[] {
  const options: ScriptBeatOption[] = [];
  (scenes || []).forEach((scene, sceneIndex) => {
    (scene.beats || []).forEach((beat, beatIndex) => {
      const cleanText = (beat.text || '').trim();
      if (!cleanText) return;
      options.push({
        beatKey: buildBeatKey(sceneIndex, beatIndex),
        sceneIndex,
        sceneNumber: scene.sceneNumber || String(sceneIndex + 1),
        slugline: scene.slugline || `Escena ${sceneIndex + 1}`,
        beatIndex,
        beatType: beat.type,
        character: beat.character,
        parenthetical: beat.parenthetical,
        text: cleanText,
      });
    });
  });
  return options;
}

export function clampTtsRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1.0;
  return Math.min(1.5, Math.max(0.65, Number(rate.toFixed(2))));
}

export function clampPitchSemitones(semitones: number): number {
  if (!Number.isFinite(semitones)) return 0;
  return Math.min(6, Math.max(-6, Math.round(semitones)));
}

export function estimateSpeechDurationSec(text: string, rate = 1.0): number {
  const safeRate = clampTtsRate(rate);
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const pauseMatches = text.match(/[,.;:!?—…]/g) || [];
  const rawSeconds = (words.length / 2.6 + pauseMatches.length * 0.14 + 0.35) / safeRate;
  return Number(Math.min(18, Math.max(1.2, rawSeconds)).toFixed(2));
}

function hashTextSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export interface SynthesizedMockVoiceover {
  wavBytes: Uint8Array;
  durationSec: number;
  sampleRate: number;
  waveform: number[];
  wordCount: number;
}

/**
 * Generates a real playable 16-bit mono RIFF/WAVE scratch voiceover audio clip
 * with syllable-level prosody envelopes, pitch inflection, and formant harmonics.
 */
export function synthesizeMockVoiceoverWav(params: {
  text: string;
  voiceId: MockTtsVoiceId;
  emotion: MockTtsEmotion;
  rate: number;
  pitchSemitones: number;
}): SynthesizedMockVoiceover {
  const cleanText = params.text.trim() || 'Prueba de voz provisional.';
  const words = cleanText.split(/\s+/).filter(Boolean);
  const rate = clampTtsRate(params.rate);
  const pitchSemitones = clampPitchSemitones(params.pitchSemitones);
  const durationSec = estimateSpeechDurationSec(cleanText, rate);

  const voice =
    MOCK_TTS_VOICES.find((v) => v.id === params.voiceId) || MOCK_TTS_VOICES[0];
  const emotionSpec =
    MOCK_TTS_EMOTIONS.find((e) => e.id === params.emotion) || MOCK_TTS_EMOTIONS[0];

  const sampleRate = 16000;
  const numSamples = Math.max(sampleRate, Math.round(durationSec * sampleRate));
  const dataByteLength = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  // RIFF / WAVE PCM16 header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM linear
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const baseFreq = voice.basePitchHz * Math.pow(2, pitchSemitones / 12);
  const syllableRateHz = (3.4 + Math.min(2.2, words.length * 0.06)) * rate;
  const seed = hashTextSeed(cleanText);
  const isQuestion = cleanText.endsWith('?');

  const waveformBars = 48;
  const samplesPerBar = Math.max(1, Math.floor(numSamples / waveformBars));
  const waveformAccumulator = new Float32Array(waveformBars);

  let phase = 0;
  let noiseState = (seed % 9973) + 17;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = i / numSamples;

    // Smooth lead-in and tail fade (60ms)
    const fadeIn = Math.min(1, t / 0.06);
    const fadeOut = Math.min(1, (durationSec - t) / 0.08);
    const boundaryEnv = Math.max(0, Math.min(fadeIn, fadeOut));

    // Word / syllable cadence with natural micro-pauses
    const wordPos = progress * Math.max(1, words.length);
    const currentWord = words[Math.min(words.length - 1, Math.floor(wordPos))] || '';
    const wordFrac = wordPos - Math.floor(wordPos);
    const hasPunctuationPause = /[,.;:!?—…]$/.test(currentWord) && wordFrac > 0.72;

    const syllableWave = 0.5 + 0.5 * Math.sin(2 * Math.PI * syllableRateHz * t + (seed % 7));
    const cadenceEnv = hasPunctuationPause ? 0.08 : 0.28 + 0.72 * Math.pow(syllableWave, 0.75);

    // Expressive pitch contour
    const phraseBend = isQuestion
      ? 1 + 0.14 * Math.pow(progress, 1.8)
      : 1 + 0.06 * Math.sin(Math.PI * progress) - 0.07 * Math.pow(progress, 2);
    const vibrato = 1 + emotionSpec.vibratoDepth * Math.sin(2 * Math.PI * 5.2 * t);
    const instFreq = baseFreq * phraseBend * vibrato;
    phase += (2 * Math.PI * instFreq) / sampleRate;

    // Harmonic formant blend (fundamental + 2nd + 3rd + soft breath noise)
    noiseState = (noiseState * 1664525 + 1013904223) >>> 0;
    const breathNoise = ((noiseState / 0xffffffff) * 2 - 1) * (params.emotion === 'whisper' ? 0.16 : 0.035);

    const fundamental = Math.sin(phase) * 0.55;
    const formant2 = Math.sin(phase * 2.0 * voice.formantShift) * 0.28;
    const formant3 = Math.sin(phase * 3.04 * voice.formantShift) * 0.14;

    const sampleVal =
      (fundamental + formant2 + formant3 + breathNoise) *
      boundaryEnv *
      cadenceEnv *
      emotionSpec.energy *
      0.55;

    const clamped = Math.max(-0.98, Math.min(0.98, sampleVal));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);

    const barIdx = Math.min(waveformBars - 1, Math.floor(i / samplesPerBar));
    waveformAccumulator[barIdx] = Math.max(waveformAccumulator[barIdx], Math.abs(clamped));
  }

  const maxPeak = Math.max(0.05, ...Array.from(waveformAccumulator));
  const waveform = Array.from(waveformAccumulator).map((v) =>
    Number(Math.min(1, Math.max(0.08, v / maxPeak)).toFixed(2))
  );

  return {
    wavBytes: new Uint8Array(buffer),
    durationSec: Number((numSamples / sampleRate).toFixed(2)),
    sampleRate,
    waveform,
    wordCount: words.length,
  };
}

export function createWavBlobUrl(wavBytes: Uint8Array): string {
  const copy = new Uint8Array(wavBytes.byteLength);
  copy.set(wavBytes);
  const blob = new Blob([copy.buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
