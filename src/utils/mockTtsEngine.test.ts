import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampPitchSemitones,
  clampTtsRate,
  estimateSpeechDurationSec,
  extractScriptBeatOptions,
  synthesizeMockVoiceoverWav,
} from './mockTtsEngine.ts';
import type { ScreenplayScene } from '../types/studio.ts';

test('extractScriptBeatOptions flattens scenes and builds deterministic beat keys', () => {
  const scenes: ScreenplayScene[] = [
    {
      sceneNumber: '1',
      slugline: 'INT. SALA DE MÁQUINAS - NOCHE',
      timeOfDay: 'NOCHE',
      beats: [
        { type: 'action', text: 'El vapor cubre los manómetros.' },
        {
          type: 'dialogue',
          character: 'CAPITÁN VERA',
          parenthetical: 'en voz baja',
          text: 'Nadie abre esa compuerta hasta el amanecer.',
        },
      ],
    },
    {
      sceneNumber: '2',
      slugline: 'EXT. MUELLE - AMANECER',
      timeOfDay: 'AMANECER',
      beats: [{ type: 'camera', text: 'Travelling lateral lento sobre la niebla.' }],
    },
  ];

  const options = extractScriptBeatOptions(scenes);
  assert.equal(options.length, 3);
  assert.equal(options[0].beatKey, '0:0');
  assert.equal(options[1].beatKey, '0:1');
  assert.equal(options[1].character, 'CAPITÁN VERA');
  assert.equal(options[2].beatKey, '1:0');
  assert.equal(options[2].sceneNumber, '2');
});

test('estimateSpeechDurationSec scales inversely with rate and clamps bounds', () => {
  const normal = estimateSpeechDurationSec('Uno dos tres cuatro cinco seis siete ocho nueve diez.', 1.0);
  const fast = estimateSpeechDurationSec('Uno dos tres cuatro cinco seis siete ocho nueve diez.', 1.4);
  assert.ok(fast < normal);
  assert.equal(clampTtsRate(3.0), 1.5);
  assert.equal(clampTtsRate(0.1), 0.65);
  assert.equal(clampPitchSemitones(12), 6);
  assert.equal(clampPitchSemitones(-10), -6);
});

test('synthesizeMockVoiceoverWav writes a valid RIFF/WAVE PCM16 buffer and 48 waveform bars', () => {
  const result = synthesizeMockVoiceoverWav({
    text: 'Aquí comienza la travesía hacia el horizonte norte.',
    voiceId: 'narrator-baritone',
    emotion: 'dramatic',
    rate: 1.0,
    pitchSemitones: -2,
  });

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...result.wavBytes.slice(start, start + len));

  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(12, 4), 'fmt ');
  assert.equal(ascii(36, 4), 'data');

  const view = new DataView(
    result.wavBytes.buffer,
    result.wavBytes.byteOffset,
    result.wavBytes.byteLength
  );
  const dataSize = view.getUint32(40, true);
  assert.equal(result.wavBytes.byteLength, 44 + dataSize);
  assert.equal(result.sampleRate, 16000);
  assert.equal(result.waveform.length, 48);
  assert.ok(result.waveform.every((v) => v >= 0.08 && v <= 1));
  assert.equal(result.wordCount, 8);
});
