import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectApiProviderSpec,
  isPrivateOrReservedIp,
  maskApiKey,
  validateExternalEndpointUrl,
} from './apiProviders.ts';

describe('apiProviders security & auto-detection', () => {
  it('blocks private, loopback, metadata, and link-local IPs for SSRF defense', () => {
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
    assert.equal(isPrivateOrReservedIp('172.16.12.4'), true);
    assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIp('localhost'), true);
    assert.equal(isPrivateOrReservedIp('::1'), true);
    assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
    assert.equal(isPrivateOrReservedIp('api.replicate.com'), false);
  });

  it('requires HTTPS and rejects embedded credentials in external endpoints', () => {
    assert.equal(validateExternalEndpointUrl('http://api.openai.com/v1/images').valid, false);
    assert.equal(validateExternalEndpointUrl('https://user:pass@api.openai.com/v1').valid, false);
    assert.equal(validateExternalEndpointUrl('https://127.0.0.1:8080/gen').valid, false);
    assert.equal(
      validateExternalEndpointUrl('https://router.huggingface.co/hf-inference/models/flux').valid,
      true
    );
  });

  it('masks API keys safely without exposing full secrets', () => {
    assert.equal(maskApiKey(''), 'Sin clave (acceso libre)');
    assert.equal(maskApiKey('short'), '••••••••');
    assert.equal(maskApiKey('hf_1234567890abcdef'), 'hf_1••••cdef');
  });

  it('auto-detects free and paid providers by API key prefix or endpoint URL', () => {
    const hf = detectApiProviderSpec({
      capability: 'image',
      apiKey: 'hf_abcdefghijklmnop',
    });
    assert.equal(hf.providerKind, 'huggingface');
    assert.equal(hf.tier, 'free');

    const replicate = detectApiProviderSpec({
      capability: 'video',
      apiKey: 'r8_abcdefghijklmnop',
    });
    assert.equal(replicate.providerKind, 'replicate');
    assert.equal(replicate.tier, 'paid');
    assert.equal(replicate.supportsImageToVideo, true);

    const geminiImg = detectApiProviderSpec({
      capability: 'image',
      apiKey: 'AIzaSyDummyKeyValue12345678',
      tierHint: 'paid',
    });
    assert.equal(geminiImg.providerKind, 'gemini');
    assert.equal(geminiImg.model, 'gemini-nano-banana-2.1');

    const pollinations = detectApiProviderSpec({
      capability: 'image',
      providerHint: 'pollinations',
    });
    assert.equal(pollinations.providerKind, 'pollinations');
    assert.equal(pollinations.tier, 'free');

    const customFree = detectApiProviderSpec({
      capability: 'video',
      endpointUrl: 'https://video-engine.example.com/v1/render',
      tierHint: 'free',
    });
    assert.equal(customFree.providerKind, 'custom_rest');
    assert.equal(customFree.tier, 'free');
  });
});
