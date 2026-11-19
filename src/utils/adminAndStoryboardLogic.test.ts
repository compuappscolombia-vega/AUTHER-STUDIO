import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADMIN_AGENT_PROFILE,
  buildAdminTrainingPromptBlock,
  computeSequenceDiagnostics,
  normalizeAdminAgentProfile,
  normalizeFourKeyStoryboardFrames,
  validateAdminDirective,
} from './adminAndStoryboardLogic';
import { buildLocalPreviewFixture } from './devPreviewFixture';

test('normalizeAdminAgentProfile fills safe defaults and trims fields', () => {
  const normalized = normalizeAdminAgentProfile({
    strictContinuityMode: false,
    customDirectives: '  Priorizar lentes anamórficos de 40mm en diálogos íntimos.  ',
    preferredVisualGrammar: '',
  });
  assert.equal(normalized.strictContinuityMode, false);
  assert.equal(
    normalized.customDirectives,
    'Priorizar lentes anamórficos de 40mm en diálogos íntimos.'
  );
  assert.equal(
    normalized.preferredVisualGrammar,
    DEFAULT_ADMIN_AGENT_PROFILE.preferredVisualGrammar
  );
});

test('validateAdminDirective enforces maximum character budget', () => {
  assert.equal(validateAdminDirective('Mantener temperatura 3200K en interiores.').valid, true);
  assert.equal(validateAdminDirective('a'.repeat(2005)).valid, false);
});

test('buildAdminTrainingPromptBlock injects strict continuity and custom directives', () => {
  const block = buildAdminTrainingPromptBlock({
    ...DEFAULT_ADMIN_AGENT_PROFILE,
    strictContinuityMode: true,
    customDirectives: 'Nunca alterar el color del abrigo de Elena.',
  });
  assert.match(block, /MODO CONTINUIDAD ESTRICTA ACTIVO/);
  assert.match(block, /Nunca alterar el color del abrigo de Elena/);
});

test('normalizeFourKeyStoryboardFrames always outputs exactly 4 key storyboard frames calibrated to resolution', () => {
  const project = buildLocalPreviewFixture()[0];
  const sequence = project.sequences[0];

  const frames = normalizeFourKeyStoryboardFrames(
    [
      {
        title: 'Apertura en el Muelle',
        shotRef: 'Plano 1A',
        cameraSpec: 'ARRI Alexa 65 · 28mm',
        visualPrompt: 'Foggy northern pier at dawn, charcoal wool coat',
        veoMotionPrompt: 'Slow crane descent through mist',
      },
      {
        title: 'Encuentro en el Umbral',
        shotRef: 'Plano 1D',
        cameraSpec: 'ARRI Alexa 65 · 40mm',
        visualPrompt: 'Silhouette of Captain Mercer in lighthouse doorway',
        veoMotionPrompt: 'Gentle dolly push-in toward doorway',
      },
    ],
    {
      sequence,
      resolution: '4K',
      idPrefix: 'test-sb',
    }
  );

  assert.equal(frames.length, 4);
  assert.equal(frames[0].id, 'test-sb-1');
  assert.equal(frames[3].id, 'test-sb-4');
  assert.equal(frames[0].aspectRatio, '2.39:1');
  assert.ok(frames[0].visualPrompt.includes('4K'));
  assert.ok(frames[2].title.includes('03 · Clímax Dramático'));
  assert.ok(frames[3].visualPrompt.length > 20);
});

test('computeSequenceDiagnostics scores complete vs empty sequences accurately', () => {
  const project = buildLocalPreviewFixture()[0];
  const sequence = project.sequences[0];
  const metrics = computeSequenceDiagnostics(project, sequence);

  assert.equal(metrics.shotCount, 6);
  assert.equal(metrics.screenplaySceneCount, 1);
  assert.equal(metrics.voiceOverCount, 2);
  assert.equal(metrics.hasContinuityBible, true);
  assert.equal(metrics.hasHyperRealisticPrompt, true);
  assert.equal(metrics.readinessScore, 90);

  const emptyMetrics = computeSequenceDiagnostics(project, null);
  assert.equal(emptyMetrics.readinessScore, 0);
});
