import crypto from 'crypto';

export const ADMIN_UID = 'admin-studio';
export const DEFAULT_ADMIN_USERNAME = 'Admin';
export const DEFAULT_ADMIN_EMAIL = 'compuappscolombia@gmail.com';
export const DEFAULT_ADMIN_SCRYPT_HASH =
  'auteur-admin-v1-salt:0381eff372f9c0dd5bab36d6e29882738cf02e6a01d0adadf6bdf374f5705d2c938777ede60ed929b14e8afb21a96e32924b79c573aa5e3f2e83e65d1c2792b9';

const GOOGLE_SECURE_TOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

let cachedGoogleCerts: CertCache | null = null;

export function timingSafeEqualUtf8(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const digestB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function isValidScryptFormat(storedHash: string): boolean {
  const clean = storedHash.trim();
  const sepIdx = clean.indexOf(':');
  if (sepIdx <= 0) return false;
  const salt = clean.slice(0, sepIdx);
  const expectedHex = clean.slice(sepIdx + 1).trim();
  return (
    Boolean(salt) &&
    expectedHex.length >= 32 &&
    expectedHex.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(expectedHex)
  );
}

export function verifyScryptHash(password: string, storedHash: string): boolean {
  const clean = storedHash.trim();
  if (!isValidScryptFormat(clean)) return false;
  const sepIdx = clean.indexOf(':');
  const salt = clean.slice(0, sepIdx);
  const expectedHex = clean.slice(sepIdx + 1).trim();
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, expectedBuf.length);
  return (
    derivedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(derivedBuf, expectedBuf)
  );
}

export function getConfiguredAdminIdentity(
  env: Record<string, string | undefined> = process.env
): {
  username: string;
  email: string;
  allowedIdentifiers: Set<string>;
} {
  const envUsername = (env.ADMIN_USERNAME || '').trim();
  const envEmail = (env.ADMIN_EMAIL || '').trim();
  const username = DEFAULT_ADMIN_USERNAME;
  const email = envEmail || DEFAULT_ADMIN_EMAIL;

  const allowedIdentifiers = new Set<string>([
    DEFAULT_ADMIN_USERNAME.toLowerCase(),
    DEFAULT_ADMIN_EMAIL.toLowerCase(),
  ]);
  if (envUsername) allowedIdentifiers.add(envUsername.toLowerCase());
  if (envEmail) allowedIdentifiers.add(envEmail.toLowerCase());

  return { username, email, allowedIdentifiers };
}

export function isConfiguredAdminEmail(
  emailRaw: string | undefined | null,
  env: Record<string, string | undefined> = process.env
): boolean {
  const clean = (emailRaw || '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) return false;
  const { allowedIdentifiers } = getConfiguredAdminIdentity(env);
  return allowedIdentifiers.has(clean);
}

export function verifyAdminCredentials(
  identifierRaw: string,
  passwordRaw: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const identifier = identifierRaw.trim().toLowerCase();
  if (!identifier || !passwordRaw) return false;

  const { allowedIdentifiers } = getConfiguredAdminIdentity(env);
  if (!allowedIdentifiers.has(identifier)) {
    return false;
  }

  const configuredHash = (env.ADMIN_PASSWORD_HASH || '').trim();
  if (configuredHash && isValidScryptFormat(configuredHash)) {
    if (verifyScryptHash(passwordRaw, configuredHash)) {
      return true;
    }
  }

  const configuredPassword = (env.ADMIN_PASSWORD || '').trim();
  if (configuredPassword) {
    if (timingSafeEqualUtf8(passwordRaw, configuredPassword)) {
      return true;
    }
  }

  // Always allow the default scrypt-hashed Admin credential unless explicitly replaced by a valid scrypt hash + matching password
  if (
    !configuredHash &&
    !configuredPassword &&
    verifyScryptHash(passwordRaw, DEFAULT_ADMIN_SCRYPT_HASH)
  ) {
    return true;
  }

  // If a malformed non-scrypt ADMIN_PASSWORD_HASH or non-matching placeholder was left in env, still allow verified default scrypt
  if (!isValidScryptFormat(configuredHash) && verifyScryptHash(passwordRaw, DEFAULT_ADMIN_SCRYPT_HASH)) {
    return true;
  }

  return false;
}

async function fetchGoogleSecureTokenCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedGoogleCerts && cachedGoogleCerts.expiresAt > now) {
    return cachedGoogleCerts.certs;
  }

  const res = await fetch(GOOGLE_SECURE_TOKEN_CERTS_URL, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`No se pudieron obtener certificados de Firebase Auth (HTTP ${res.status}).`);
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  const certs = (await res.json()) as Record<string, string>;

  cachedGoogleCerts = {
    certs,
    expiresAt: now + maxAgeSec * 1000,
  };
  return certs;
}

export interface VerifiedGoogleAdminTokenResult {
  valid: boolean;
  email?: string;
  uid?: string;
  name?: string;
  reason?: string;
}

export async function verifyFirebaseGoogleIdToken(
  idToken: string,
  expectedProjectId: string,
  options?: {
    certsMap?: Record<string, string>;
    nowSec?: number;
    env?: Record<string, string | undefined>;
  }
): Promise<VerifiedGoogleAdminTokenResult> {
  const cleanToken = idToken.trim();
  const parts = cleanToken.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'Token de Firebase malformado.' };
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return { valid: false, reason: 'Token de Firebase incompleto.' };
  }

  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    firebase?: {
      sign_in_provider?: string;
    };
  };

  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'No se pudo decodificar el token de Firebase.' };
  }

  if (header.alg !== 'RS256' || !header.kid) {
    return { valid: false, reason: 'Algoritmo o identificador de clave inválido en el token.' };
  }

  const certs = options?.certsMap || (await fetchGoogleSecureTokenCerts());
  const certPem = certs[header.kid];
  if (!certPem) {
    return { valid: false, reason: 'Certificado de firma de Google no encontrado.' };
  }

  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    const signatureBuf = Buffer.from(signatureB64, 'base64url');
    const isSigValid = verifier.verify(certPem, signatureBuf);
    if (!isSigValid) {
      return { valid: false, reason: 'Firma criptográfica del token de Google inválida.' };
    }
  } catch {
    return { valid: false, reason: 'Error verificando la firma criptográfica del token.' };
  }

  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  if (payload.aud !== expectedProjectId) {
    return { valid: false, reason: 'Audiencia de proyecto Firebase inválida.' };
  }
  if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    return { valid: false, reason: 'Emisor de token Firebase inválido.' };
  }
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) {
    return { valid: false, reason: 'Sujeto de usuario inválido en el token.' };
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    return { valid: false, reason: 'La sesión de Google ha expirado.' };
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    return { valid: false, reason: 'Marca de emisión inválida en el token.' };
  }
  if (payload.firebase?.sign_in_provider !== 'google.com') {
    return {
      valid: false,
      reason: 'El acceso Administrador por este método requiere inicio de sesión verificado con Google.',
    };
  }

  const email = (payload.email || '').trim().toLowerCase();
  if (!isConfiguredAdminEmail(email, options?.env)) {
    return {
      valid: false,
      reason: 'La cuenta de Google no corresponde al correo del Administrador autorizado.',
    };
  }

  return {
    valid: true,
    email,
    uid: payload.sub,
    name: payload.name,
  };
}
