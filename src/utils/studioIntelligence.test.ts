import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRatedChoiceLessons,
  buildStudioIntelligence,
} from './studioIntelligence';
import { SEED_PROJECTS } from '../data/seedProjects';
import type { LearningLesson } from '../types/studio';

const SAMPLE_LESSONS: LearningLesson[] = [
  {
    id: 'l-1',
    category: 'camera',
    insight: 'Sostener planos IMAX 1.43:1 de 10s con grúa lenta antes del corte.',
    rating: 5,
    sourceProjectTitle: 'El Libro de Enoc',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'l-2',
    category: 'lighting',
    insight: 'Contraste térmico 2900K vs 6200K para separar humanidad y amenaza.',
    rating: 5,
    sourceProjectTitle: 'El Libro de Enoc',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'l-3',
    category: 'sound',
    insight: 'Silencio de 1.5s antes del golpe LFE a 32 Hz.',
    rating: 4,
    sourceProjectTitle: 'La Última Frecuencia',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
];

test('buildStudioIntelligence aggregates cross-project camera, lighting, and sound patterns', () => {
  const activeProject = SEED_PROJECTS[1];
  const activeSequence = activeProject.sequences[0];

  const report = buildStudioIntelligence({
    projects: SEED_PROJECTS,
    lessons: SAMPLE_LESSONS,
    activeProject,
    activeSequence,
  });

  assert.ok(report.finalizedSequencesCount >= 2);
  assert.ok(report.totalTrackedOutcomes >= 5);
  assert.ok(report.topCameraPatterns.length > 0);
  assert.ok(report.topLightingSetups.length > 0);
  assert.ok(report.topSoundscapes.length > 0);
  assert.equal(report.enhancements.length, 3);
  assert.deepEqual(
    report.enhancements.map((e) => e.category),
    ['camera', 'lighting', 'sound']
  );
});

test('buildRatedChoiceLessons extracts camera, lighting, and sound lessons with clamped rating', () => {
  const seq = SEED_PROJECTS[0].sequences[0];
  const lessons = buildRatedChoiceLessons({
    projectTitle: SEED_PROJECTS[0].title,
    sequence: seq,
    rating: 5,
    note: 'Funciona excelente en IMAX',
  });

  assert.equal(lessons.length, 3);
  assert.equal(lessons[0].category, 'camera');
  assert.equal(lessons[1].category, 'lighting');
  assert.equal(lessons[2].category, 'sound');
  assert.ok(lessons[0].insight.includes('Funciona excelente en IMAX'));
});
