import test from 'node:test';
import assert from 'node:assert/strict';
import { exportSequencePdf, exportLibraryPdf } from './pdfExporter';
import { SEED_PROJECTS } from '../data/seedProjects';

test('exportSequencePdf rejects draft sequences strictly', async () => {
  const draftProject = SEED_PROJECTS.find((p) =>
    p.sequences.some((s) => s.versionStatus === 'draft')
  );
  assert.ok(draftProject);
  const draftSeq = draftProject.sequences.find((s) => s.versionStatus === 'draft')!;

  await assert.rejects(
    () => exportSequencePdf(draftProject, draftSeq),
    /Versión Final/i
  );
});

test('exportLibraryPdf rejects projects with no final sequences', async () => {
  const draftOnlyProject = {
    ...SEED_PROJECTS[1],
    sequences: SEED_PROJECTS[1].sequences.map((s) => ({
      ...s,
      versionStatus: 'draft' as const,
    })),
  };

  await assert.rejects(
    () => exportLibraryPdf(draftOnlyProject),
    /Versión Final/i
  );
});
