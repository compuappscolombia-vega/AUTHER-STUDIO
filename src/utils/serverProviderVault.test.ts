import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ProviderConfigurationError,
  executeVideoGeneration,
  listPublicProviders,
} from './serverProviderVault.ts';

describe('serverProviderVault frameo_video isolation', () => {
  it('hides frameo_video configuration unless includeAdminFrameo is explicitly true', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auteur-vault-test-'));
    try {
      const regular = listPublicProviders('regular-user', tmpDir);
      assert.equal(regular.frameo_video.configured, false);
      assert.equal(regular.frameo_video.lastMessage, 'Disponible exclusivamente en el perfil Administrador.');

      const admin = listPublicProviders('admin-studio', tmpDir, { includeAdminFrameo: true });
      assert.equal(admin.frameo_video.configured, false);
      assert.match(admin.frameo_video.label, /Frameo IA/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rejects frameo_video execution cleanly with API_NOT_CONFIGURED when unconfigured instead of falling back', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auteur-vault-exec-'));
    try {
      const userVaultDir = path.join(tmpDir, 'users', 'admin-studio');
      fs.mkdirSync(userVaultDir, { recursive: true });
      // Configure ONLY standard 'video' capability, NOT 'frameo_video'
      fs.writeFileSync(
        path.join(userVaultDir, 'api_providers.json'),
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          providers: {
            video: {
              capability: 'video',
              providerKind: 'custom_rest',
              label: 'Manual Backup Video API',
              tier: 'free',
              endpointUrl: 'https://example.com/video',
              model: 'manual-v1',
              authHeader: 'Authorization',
              authPrefix: 'Bearer ',
              supportsImageToVideo: true,
              keyPreview: 'Sin clave',
              lastTestedAt: new Date().toISOString(),
              lastStatus: 'ready',
              lastMessage: 'OK',
            },
          },
        })
      );

      await assert.rejects(
        () =>
          executeVideoGeneration(
            'admin-studio',
            {
              prompt: 'Slow cinematic dolly in misty harbor',
              aspectRatio: '16:9',
              duration: '5s',
              capability: 'frameo_video',
            },
            tmpDir
          ),
        (err: unknown) => {
          assert.ok(err instanceof ProviderConfigurationError);
          assert.equal(err.code, 'API_NOT_CONFIGURED');
          assert.equal(err.capability, 'frameo_video');
          assert.equal(err.status, 428);
          return true;
        }
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
