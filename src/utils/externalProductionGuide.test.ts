import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExternalProductionGuide } from './externalProductionGuide.ts';
import { buildLocalPreviewFixture } from './devPreviewFixture.ts';

describe('buildExternalProductionGuide (Agente Arthur)', () => {
  it('builds a complete step-by-step external production document for an active sequence', () => {
    const project = buildLocalPreviewFixture()[0];
    const sequence = project.sequences[0];
    const guide = buildExternalProductionGuide({ project, sequence, scope: 'sequence' });

    assert.equal(guide.agentName, 'Agente Arthur');
    assert.equal(guide.projectTitle, project.title);
    assert.equal(guide.sequenceTitle, sequence.title);
    assert.ok(guide.sections.length >= 6);

    // Step 1: Configuration & Continuity
    assert.ok(guide.sections[0].items.some((item) => Boolean(item.copyPromptText)));
    // Step 3: Frame prompts with aspect flag
    const imageStep = guide.sections[2];
    assert.equal(imageStep.items.length, sequence.storyboardFrames.length);
    assert.ok(imageStep.items[0].copyPromptText?.includes('--ar'));

    // Step 4: Shot video motion prompts
    const videoStep = guide.sections[3];
    assert.equal(videoStep.items.length, sequence.shotList.length);
    assert.ok(videoStep.items[0].copyPromptText?.length);

    // Step 6: Assembly timeline with 00:00 start
    const assemblyStep = guide.sections[5];
    assert.ok(assemblyStep.items[0].instructions.includes('00:00 ->'));

    // Full Markdown & plain text formats
    assert.ok(guide.markdown.includes('# Agente Arthur'));
    assert.ok(guide.plainText.includes('AGENTE ARTHUR'));
  });

  it('includes trailer 30s production steps when project has a trailer', () => {
    const project = buildLocalPreviewFixture()[0];
    project.trailer = {
      id: 'tr-1',
      title: 'Horizonte Cero',
      tagline: 'Ninguna señal regresa igual.',
      tone: 'Suspenso Noir',
      targetResolution: '4K',
      totalDurationSec: 30,
      voicePreset: 'Charon',
      voiceDirection: 'Susurro tenso y contenido',
      voiceOverScript: 'Cuando la antena respondió, supimos que no estábamos solos.',
      musicPrompt: 'Cello ostinato 96 BPM dark tension',
      tempoBpm: 96,
      soundMixNotes: 'Sub-bass hit en corte 5',
      approvedSequenceIds: [project.sequences[0].id],
      beats: [
        {
          id: 'b1',
          beatNumber: 1,
          startSec: 0,
          endSec: 5,
          durationSec: 5,
          sourceSequenceId: project.sequences[0].id,
          sourceSequenceTitle: project.sequences[0].title,
          visualDescription: 'Antena bajo lluvia nocturna',
          hyperRealisticPrompt: 'Wide shot giant radio telescope under rain 4K',
          motionPrompt: 'Slow push-in crane descending',
          voiceOverLine: 'Escuchamos durante veinte años.',
          onScreenTitleCard: 'DEL SILENCIO',
          sfxCue: 'Sub-bass boom 38Hz',
          editingTransition: 'Cut to black',
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const guide = buildExternalProductionGuide({ project, scope: 'project' });
    const trailerSec = guide.sections.find((s) => s.id === 'step-7-trailer');
    assert.ok(trailerSec);
    assert.ok(guide.markdown.includes('Tráiler Oficial de 30 Segundos'));
    assert.ok(trailerSec.items.some((i) => i.copyPromptText?.includes('DEL SILENCIO')));
  });
});
