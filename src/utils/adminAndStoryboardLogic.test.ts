import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADMIN_AGENT_PROFILE,
  FRAMEO_MODEL_CATALOG,
  FRAMEO_VFX_MANTO_MODES,
  buildAdminTrainingPromptBlock,
  buildFrameoProductionSpecForSequence,
  buildFrameoShotFilename,
  computeSequenceDiagnostics,
  normalizeAdminAgentProfile,
  normalizeFourKeyStoryboardFrames,
  validateAdminDirective,
} from './adminAndStoryboardLogic.ts';
import { buildExternalProductionGuide } from './externalProductionGuide.ts';
import { buildLocalPreviewFixture } from './devPreviewFixture.ts';

test('normalizeAdminAgentProfile fills safe defaults and trims fields', () => {
  const normalized = normalizeAdminAgentProfile({
    strictContinuityMode: false,
    customDirectives: '  Priorizar lentes anamórficos de 40mm en diálogos íntimos.  ',
    preferredVisualGrammar: '',
    frameoIaModel: 'Kling O3',
    frameoIaVfxMode: 'añade_al_plano',
    frameoIaRenderQuality: '480p_preview',
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
  assert.equal(normalized.frameoIaEnabled, true);
  assert.equal(normalized.frameoIaAutoGenerateVideo, true);
  assert.equal(normalized.frameoIaAspectRatio, '16:9');
  assert.equal(normalized.frameoIaClipDurationSec, 5);
  assert.equal(normalized.frameoIaModel, 'Kling O3');
  assert.equal(normalized.frameoIaVfxMode, 'añade_al_plano');
  assert.equal(normalized.frameoIaRenderQuality, '480p_preview');
});

test('FRAMEO_MODEL_CATALOG, FRAMEO_VFX_MANTO_MODES, and buildFrameoShotFilename match Frameo studio spec', () => {
  assert.ok(FRAMEO_MODEL_CATALOG.includes('Veo 3.1 Rápido'));
  assert.ok(FRAMEO_MODEL_CATALOG.includes('Kling O3'));
  assert.ok(FRAMEO_MODEL_CATALOG.includes('Semilla 2,5'));
  assert.ok(FRAMEO_VFX_MANTO_MODES.some((m) => m.includes('Cambiar de contexto')));
  assert.ok(FRAMEO_VFX_MANTO_MODES.some((m) => m.includes('Extensión de conjunto')));
  const shotName = buildFrameoShotFilename('La Última Guardia del Faro', 1, 3, 4);
  assert.equal(shotName, 'LUG_EP01_SH003_v004.mov');
});

test('validateAdminDirective enforces maximum character budget', () => {
  assert.equal(validateAdminDirective('Mantener temperatura 3200K en interiores.').valid, true);
  assert.equal(validateAdminDirective('a'.repeat(2005)).valid, false);
});

test('buildAdminTrainingPromptBlock injects strict continuity and scopes Frameo IA exclusively to Admin', () => {
  const standardBlock = buildAdminTrainingPromptBlock({
    ...DEFAULT_ADMIN_AGENT_PROFILE,
    strictContinuityMode: true,
    customDirectives: 'Nunca alterar el color del abrigo de Elena.',
  });
  assert.match(standardBlock, /MODO CONTINUIDAD ESTRICTA ACTIVO/);
  assert.match(standardBlock, /Nunca alterar el color del abrigo de Elena/);
  assert.equal(standardBlock.includes('FRAMEO IA'), false);

  const adminFrameoBlock = buildAdminTrainingPromptBlock(
    {
      ...DEFAULT_ADMIN_AGENT_PROFILE,
      frameoIaEnabled: true,
      frameoIaAspectRatio: '9:16',
      frameoIaClipDurationSec: 6,
      frameoIaModel: 'Kling O3',
      frameoIaVfxMode: 'extension_conjunto',
      frameoIaRenderQuality: '480p_preview',
    },
    { includeFrameoIa: true }
  );
  assert.match(adminFrameoBlock, /FRAMEO IA/);
  assert.match(adminFrameoBlock, /9:16/);
  assert.match(adminFrameoBlock, /6s/);
  assert.match(adminFrameoBlock, /Kling O3/);
  assert.match(adminFrameoBlock, /480P/);
});

test('buildFrameoProductionSpecForSequence outputs structured Frameo IA scenes and connects to External Guide', () => {
  const project = buildLocalPreviewFixture()[0];
  const sequence = project.sequences[0];
  const spec = buildFrameoProductionSpecForSequence({
    project,
    sequence,
    profile: DEFAULT_ADMIN_AGENT_PROFILE,
  });

  assert.equal(spec.engine, 'Frameo IA');
  assert.ok(spec.scenes.length >= 4);
  assert.ok(spec.workflowChecklist.length >= 4);
  assert.ok(spec.scenes[0].frameoVisualPrompt.includes('Frameo IA'));
  assert.ok(spec.scenes[0].frameoMotionPrompt.includes('s'));
  assert.equal(spec.modelName, DEFAULT_ADMIN_AGENT_PROFILE.frameoIaModel);
  assert.match(spec.shotNamingTemplate || '', /_EP01_SH001_v001\.mov$/);

  const frameoSequence = {
    ...sequence,
    productionEngine: 'frameo_ia' as const,
    frameoProductionSpec: spec,
  };
  const guide = buildExternalProductionGuide({
    project,
    sequence: frameoSequence,
    scope: 'sequence',
  });
  const frameoSection = guide.sections.find((s) => s.id === 'step-frameo-ia');
  assert.ok(frameoSection);
  assert.ok(guide.markdown.includes('Motor Frameo IA'));
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
