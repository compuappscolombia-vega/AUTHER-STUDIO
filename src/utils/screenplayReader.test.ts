import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBeatKey,
  computeScreenplayReadingStats,
  getBeatNotes,
  getReadingTypographyClasses,
  sortScreenplayNotes,
  validateScreenplayNote,
} from './screenplayReader';
import type { ScreenplayNote, ScreenplayScene } from '../types/studio';

test('buildBeatKey and getBeatNotes filter notes strictly by beat key', () => {
  const key0 = buildBeatKey(0, 1);
  const key1 = buildBeatKey(1, 0);
  const notes: ScreenplayNote[] = [
    {
      id: 'n1',
      beatKey: key0,
      sceneNumber: '1',
      beatIndex: 1,
      beatType: 'dialogue',
      lineExcerpt: 'Escucha el viento',
      authorRole: 'director',
      authorName: 'Director',
      note: 'Bajar música 4dB antes de entrar la réplica',
      createdAt: '2026-02-01T10:00:00.000Z',
    },
    {
      id: 'n2',
      beatKey: key1,
      sceneNumber: '2',
      beatIndex: 0,
      beatType: 'action',
      lineExcerpt: 'Abre la compuerta',
      authorRole: 'producer',
      authorName: 'Productor',
      note: 'Verificar costo práctico del vapor',
      createdAt: '2026-02-01T10:05:00.000Z',
    },
  ];

  assert.equal(key0, '0:1');
  assert.equal(getBeatNotes(notes, key0).length, 1);
  assert.equal(getBeatNotes(notes, key0)[0].id, 'n1');
  assert.equal(getBeatNotes(notes, '9:9').length, 0);
});

test('sortScreenplayNotes orders by scene index, beat index, then creation timestamp', () => {
  const notes: ScreenplayNote[] = [
    {
      id: 'late',
      beatKey: '1:0',
      sceneNumber: '2',
      beatIndex: 0,
      beatType: 'action',
      lineExcerpt: 'B',
      authorRole: 'producer',
      authorName: 'Prod',
      note: 'Escena 2',
      createdAt: '2026-02-01T09:00:00.000Z',
    },
    {
      id: 'first-b',
      beatKey: '0:2',
      sceneNumber: '1',
      beatIndex: 2,
      beatType: 'dialogue',
      lineExcerpt: 'A2',
      authorRole: 'director',
      authorName: 'Dir',
      note: 'Segundo beat',
      createdAt: '2026-02-01T11:00:00.000Z',
    },
    {
      id: 'first-a',
      beatKey: '0:2',
      sceneNumber: '1',
      beatIndex: 2,
      beatType: 'dialogue',
      lineExcerpt: 'A2',
      authorRole: 'producer',
      authorName: 'Prod',
      note: 'Primer beat cronológico',
      createdAt: '2026-02-01T08:00:00.000Z',
    },
  ];

  const sorted = sortScreenplayNotes(notes);
  assert.deepEqual(
    sorted.map((n) => n.id),
    ['first-a', 'first-b', 'late']
  );
});

test('validateScreenplayNote rejects too-short text and accepts director/producer notes', () => {
  assert.equal(validateScreenplayNote({ note: 'ok', role: 'director' }).valid, false);
  assert.equal(
    validateScreenplayNote({
      note: 'Reforzar primer plano 85mm en esta línea',
      role: 'director',
    }).valid,
    true
  );
  assert.equal(
    validateScreenplayNote({
      note: 'Aprobar presupuesto de lluvia artificial',
      role: 'producer',
    }).valid,
    true
  );
});

test('computeScreenplayReadingStats calculates scenes, beats, dialogues, words, and reading minutes', () => {
  const screenplay: ScreenplayScene[] = [
    {
      sceneNumber: '1',
      slugline: 'EXT. MUELLE - NOCHE',
      timeOfDay: 'NOCHE',
      beats: [
        { type: 'action', text: 'La niebla cubre el hormigón mojado.' },
        { type: 'dialogue', character: 'ELENA', text: 'No queda tiempo para volver atrás.' },
        { type: 'camera', text: 'Dolly lento hacia el rostro.' },
      ],
    },
  ];

  const stats = computeScreenplayReadingStats(screenplay, 120);
  assert.equal(stats.sceneCount, 1);
  assert.equal(stats.beatCount, 3);
  assert.equal(stats.dialogueCount, 1);
  assert.ok(stats.wordCount >= 18);
  assert.equal(stats.estimatedMinutes, 1);
});

test('getReadingTypographyClasses expands font size and line-height in comfortable and large presets', () => {
  const normal = getReadingTypographyClasses('normal');
  const comfortable = getReadingTypographyClasses('comfortable');
  const large = getReadingTypographyClasses('large');

  assert.match(normal.sheetText, /13px/);
  assert.match(comfortable.sheetText, /16px/);
  assert.match(large.sheetText, /18px/);
});
