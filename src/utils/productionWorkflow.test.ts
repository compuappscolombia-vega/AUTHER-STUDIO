import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFilmDeliveryWorkflow } from './productionWorkflow';
import { buildLocalPreviewFixture } from './devPreviewFixture';

test('computeFilmDeliveryWorkflow starts at step 1 when no project exists', () => {
  const wf = computeFilmDeliveryWorkflow({
    activeProject: null,
    activeSequence: null,
  });

  assert.equal(wf.currentStepIndex, 0);
  assert.equal(wf.nextActionKind, 'new_project');
  assert.equal(wf.completedCount, 0);
  assert.equal(wf.steps.length, 6);
});

test('computeFilmDeliveryWorkflow guides to ingest when project has no sequences', () => {
  const fixture = buildLocalPreviewFixture()[0];
  const emptyProj = { ...fixture, sequences: [], trailer: undefined };

  const wf = computeFilmDeliveryWorkflow({
    activeProject: emptyProj,
    activeSequence: null,
  });

  assert.equal(wf.currentStepIndex, 1);
  assert.equal(wf.nextActionKind, 'open_ingest');
  assert.equal(wf.steps[0].completed, true);
  assert.equal(wf.steps[1].completed, false);
});

test('computeFilmDeliveryWorkflow detects completed film delivery when trailer media exists', () => {
  const fixture = buildLocalPreviewFixture()[0];
  const seq = {
    ...fixture.sequences[0],
    versionStatus: 'final' as const,
    storyboardFrames: fixture.sequences[0].storyboardFrames.map((f, i) =>
      i === 0 ? { ...f, imageUrl: '/workspace-assets/test.png' } : f
    ),
  };
  const completeProj = {
    ...fixture,
    sequences: [seq],
    trailer: {
      id: 'tr-1',
      title: 'Teaser 30s',
      tagline: 'Muy pronto',
      tone: 'Épico',
      targetResolution: '4K' as const,
      totalDurationSec: 30,
      voicePreset: 'Charon' as const,
      voiceDirection: 'Profunda',
      voiceOverScript: 'Texto',
      voiceOverAudioUrl: '/workspace-assets/vo.wav',
      musicPrompt: 'Epic score',
      tempoBpm: 110,
      soundMixNotes: 'Atmos',
      approvedSequenceIds: [seq.id],
      beats: [],
      createdAt: '2026-02-01T10:00:00.000Z',
    },
  };

  const wf = computeFilmDeliveryWorkflow({
    activeProject: completeProj,
    activeSequence: seq,
  });

  assert.equal(wf.nextActionKind, 'done');
  assert.equal(wf.percentComplete, 100);
});
