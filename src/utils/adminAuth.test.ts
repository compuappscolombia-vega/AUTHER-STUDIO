import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_USERNAME,
  isConfiguredAdminEmail,
  verifyAdminCredentials,
  verifyFirebaseGoogleIdToken,
} from './adminAuth.ts';

function signFakeJwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  header: Record<string, unknown> = { alg: 'RS256', kid: 'test-kid-1' }
): string {
  const headerB64 = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const signatureB64 = signer.sign(privateKeyPem).toString('base64url');
  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

test('verifyAdminCredentials accepts both default Admin email and username with 20101217', () => {
  assert.equal(verifyAdminCredentials(DEFAULT_ADMIN_EMAIL, '20101217', {}), true);
  assert.equal(verifyAdminCredentials(DEFAULT_ADMIN_USERNAME, '20101217', {}), true);
  assert.equal(verifyAdminCredentials('admin', '20101217', {}), true);
  assert.equal(verifyAdminCredentials('  COMPUAPPSCOLOMBIA@GMAIL.COM  ', '20101217', {}), true);
});

test('verifyAdminCredentials rejects invalid passwords or unauthorized accounts', () => {
  assert.equal(verifyAdminCredentials(DEFAULT_ADMIN_EMAIL, 'wrong-pass', {}), false);
  assert.equal(verifyAdminCredentials('other@gmail.com', '20101217', {}), false);
  assert.equal(verifyAdminCredentials('', '20101217', {}), false);
  assert.equal(verifyAdminCredentials(DEFAULT_ADMIN_USERNAME, '', {}), false);
});

test('verifyAdminCredentials stays resilient against malformed ADMIN_PASSWORD_HASH or ADMIN_USERNAME overrides', () => {
  const brokenContainerEnv = {
    ADMIN_USERNAME: 'custom_override_name',
    ADMIN_EMAIL: DEFAULT_ADMIN_EMAIL,
    ADMIN_PASSWORD: '20101217',
    ADMIN_PASSWORD_HASH: 'malformed-hash-without-colon',
  };

  assert.equal(
    verifyAdminCredentials(DEFAULT_ADMIN_EMAIL, '20101217', brokenContainerEnv),
    true
  );
  assert.equal(
    verifyAdminCredentials(DEFAULT_ADMIN_USERNAME, '20101217', brokenContainerEnv),
    true
  );
  assert.equal(
    verifyAdminCredentials(DEFAULT_ADMIN_EMAIL, 'invalid-pass', brokenContainerEnv),
    false
  );
  assert.equal(isConfiguredAdminEmail(DEFAULT_ADMIN_EMAIL, brokenContainerEnv), true);
  assert.equal(isConfiguredAdminEmail('random@gmail.com', brokenContainerEnv), false);
});

test('verifyFirebaseGoogleIdToken verifies RS256 Google Admin tokens and rejects invalid tokens', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const projectId = 'pelagic-cat-405307';
  const nowSec = 1_800_000_000;
  const certsMap = { 'test-kid-1': publicKey };

  const validToken = signFakeJwt(
    {
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: 'google-uid-admin',
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: DEFAULT_ADMIN_EMAIL,
      email_verified: false,
      name: 'Admin Studio',
      firebase: { sign_in_provider: 'google.com' },
    },
    privateKey
  );

  const ok = await verifyFirebaseGoogleIdToken(validToken, projectId, { certsMap, nowSec });
  assert.equal(ok.valid, true);
  assert.equal(ok.email, DEFAULT_ADMIN_EMAIL);

  const nonAdminToken = signFakeJwt(
    {
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: 'google-uid-user',
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: 'director@estudio.com',
      firebase: { sign_in_provider: 'google.com' },
    },
    privateKey
  );
  const rejectedNonAdmin = await verifyFirebaseGoogleIdToken(nonAdminToken, projectId, {
    certsMap,
    nowSec,
  });
  assert.equal(rejectedNonAdmin.valid, false);

  const nonGoogleProviderToken = signFakeJwt(
    {
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: 'pw-uid',
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: DEFAULT_ADMIN_EMAIL,
      firebase: { sign_in_provider: 'password' },
    },
    privateKey
  );
  const rejectedProvider = await verifyFirebaseGoogleIdToken(nonGoogleProviderToken, projectId, {
    certsMap,
    nowSec,
  });
  assert.equal(rejectedProvider.valid, false);

  const expiredToken = signFakeJwt(
    {
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: 'google-uid-admin',
      exp: nowSec - 5,
      iat: nowSec - 3600,
      email: DEFAULT_ADMIN_EMAIL,
      firebase: { sign_in_provider: 'google.com' },
    },
    privateKey
  );
  const rejectedExpired = await verifyFirebaseGoogleIdToken(expiredToken, projectId, {
    certsMap,
    nowSec,
  });
  assert.equal(rejectedExpired.valid, false);

  const wrongAudienceToken = signFakeJwt(
    {
      aud: 'other-project',
      iss: 'https://securetoken.google.com/other-project',
      sub: 'google-uid-admin',
      exp: nowSec + 3600,
      iat: nowSec - 10,
      email: DEFAULT_ADMIN_EMAIL,
      firebase: { sign_in_provider: 'google.com' },
    },
    privateKey
  );
  const rejectedAud = await verifyFirebaseGoogleIdToken(wrongAudienceToken, projectId, {
    certsMap,
    nowSec,
  });
  assert.equal(rejectedAud.valid, false);
});
