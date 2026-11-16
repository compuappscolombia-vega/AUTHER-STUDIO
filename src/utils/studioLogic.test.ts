import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAspectRatio,
  validateSequenceInput,
  filterProjects,
  computeProjectStats,
  buildContinuationContext,
  formatScreenplayMarkdown,
  formatFountainScreenplay,
} from './studioLogic';
import type { ProductionProject, ProductionSequence } from '../types/studio';

const sampleSequence: ProductionSequence = {
  id: 'seq-1',
  title: 'Capítulo VI: El Juramento del Hermón',
  sourceType: 'book',
  directorStyle: 'Épica Monumental IMAX',
  aspectRatio: '1.43:1',
  cameraSystem: 'ARRI Alexa 65',
  lensPackage: 'Panavision Sphero 65',
  filmStockOrLut: 'Kodak 2383 Contrast',
  logline: 'Doscientos seres celestiales sellan un pacto irreversible en la cumbre helada.',
  directorVision: 'Escala monumental y silencio sagrado.',
  colorPalette: [{ name: 'Obsidiana', hex: '#0E1015', role: 'Roca basáltica' }],
  lighting: {
    keyLight: 'Luz lunar cenital fría',
    fillRatio: '8:1 Chiaroscuro',
    rimAndBacklight: 'Halo plateado a contraluz',
    colorTemperatureKelvin: '5800K / 2900K',
    atmosphereAndHaze: 'Niebla estratosférica densa',
  },
  shotList: [
    {
      shotNumber: '01A',
      shotType: 'EWS',
      lensMm: '24mm',
      movement: 'Technocrane descendente',
      durationSec: 18,
      framingNote: 'Cumbre rodeada de nubes',
      psychologicalIntent: 'Aislamiento cósmico',
    },
    {
      shotNumber: '01B',
      shotType: 'ECU',
      lensMm: '85mm',
      movement: 'Fijo en trípode pesado',
      durationSec: 12,
      framingNote: 'Pupila dilatándose',
      psychologicalIntent: 'Nacimiento del deseo',
    },
  ],
  soundDesign: {
    atmosLayers: ['Viento estratosférico'],
    subBassCue: '22 Hz constante',
    foleyDetails: ['Hielo cristalizándose'],
    silenceBeats: '2 segundos antes del juramento',
    musicalScore: 'Coro disonante y cuerno de bronce',
    tempoBpm: 56,
  },
  vfx: {
    cgiElements: ['Anillos de luz geométrica'],
    practicalSfx: ['Nieve volcánica en set'],
    locationsAndSets: 'Islandia / Monte Hermón',
    wardrobeAndMakeup: 'Túnicas de mercurio oscuro',
  },
  screenplay: [
    {
      sceneNumber: '01',
      slugline: 'EXT. CUMBRE DEL MONTE HERMÓN - NOCHE',
      timeOfDay: 'NOCHE',
      beats: [
        { type: 'camera', text: 'Plano aéreo IMAX descendiendo sobre la meseta.' },
        {
          type: 'dialogue',
          character: 'SEMJÂZÂ',
          parenthetical: 'voz grave',
          text: 'Me temo que no aceptaréis hacer este acto.',
        },
      ],
    },
  ],
  storyboardFrames: [],
  continuitySummary: 'Pacto sellado en el Hermón por los 200 Vigilantes.',
  createdAt: '2026-11-16T10:00:00.000Z',
};

const sampleProject: ProductionProject = {
  id: 'proj-enoch',
  title: 'El Libro de Enoc',
  genreStyle: 'Épica Mitológica IMAX',
  defaultSourceType: 'book',
  continuityBible: 'Vigilantes sin alas de pluma.',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  sequences: [sampleSequence],
};

test('parseAspectRatio parses valid ratios and falls back on malformed values', () => {
  assert.equal(parseAspectRatio('2.39:1'), 2.39);
  assert.equal(parseAspectRatio('1.43:1'), 1.43);
  assert.ok(Math.abs(parseAspectRatio('16:9') - 16 / 9) < 0.0001);
  assert.ok(Math.abs(parseAspectRatio('invalid') - 16 / 9) < 0.0001);
});

test('validateSequenceInput enforces title and text/file presence', () => {
  const emptyRes = validateSequenceInput({
    sequenceTitle: '',
    sourceText: 'corto',
    hasFile: false,
  });
  assert.equal(emptyRes.valid, false);
  assert.equal(emptyRes.errors.length, 2);

  const fileOk = validateSequenceInput({
    sequenceTitle: 'Escena de Audiolibro',
    sourceText: '',
    hasFile: true,
  });
  assert.equal(fileOk.valid, true);
});

test('filterProjects filters by title, genre, or sequence title', () => {
  const other: ProductionProject = {
    ...sampleProject,
    id: 'proj-2',
    title: 'La Última Frecuencia',
    genreStyle: 'Neo-Noir',
    sequences: [],
  };
  assert.equal(filterProjects([sampleProject, other], 'hermón').length, 1);
  assert.equal(filterProjects([sampleProject, other], 'noir').length, 1);
  assert.equal(filterProjects([sampleProject, other], '').length, 2);
});

test('computeProjectStats aggregates shots and duration accurately', () => {
  const stats = computeProjectStats(sampleProject);
  assert.equal(stats.sequenceCount, 1);
  assert.equal(stats.shotCount, 2);
  assert.equal(stats.estimatedMinutes, 0.5);
});

test('buildContinuationContext appends without duplicating', () => {
  const updated = buildContinuationContext(
    'Regla base.',
    'Cap. VI',
    'Pacto sellado.'
  );
  assert.match(updated, /\[Cap\. VI\]: Pacto sellado\./);
  const deduplicated = buildContinuationContext(updated, 'Cap. VI', 'Pacto sellado.');
  assert.equal(deduplicated, updated);
});

test('formatScreenplayMarkdown and formatFountainScreenplay emit structured exports', () => {
  const md = formatScreenplayMarkdown(sampleProject.title, sampleSequence);
  assert.match(md, /EL LIBRO DE ENOC/);
  assert.match(md, /EXT\. CUMBRE DEL MONTE HERMÓN - NOCHE/);
  assert.match(md, /\*\*SEMJÂZÂ\*\*/);

  const fountain = formatFountainScreenplay(sampleProject.title, sampleSequence);
  assert.match(fountain, /Title: El Libro de Enoc/);
  assert.match(fountain, /SEMJÂZÂ/);
});
