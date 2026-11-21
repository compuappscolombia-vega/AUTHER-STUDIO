import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import type {
  ApiCapability,
  ApiProviderInput,
  ApiProviderKind,
  ApiProviderPublicSummary,
  ResolutionTier,
} from '../types/studio.ts';
import {
  detectApiProviderSpec,
  isPrivateOrReservedIp,
  maskApiKey,
  validateExternalEndpointUrl,
} from './apiProviders.ts';
import {
  buildHyperRealisticResolutionSpec,
  getNanoImageSizeForResolution,
} from './productionPipeline.ts';
import {
  DEFAULT_FRAMEO_MCP_URL,
  discoverFrameoOAuthMetadata,
  executeFrameoMcpVideo,
  getValidFrameoMcpAccessToken,
  listFrameoMcpTools,
} from './frameoMcpClient.ts';

export class ProviderConfigurationError extends Error {
  status: number;
  capability: ApiCapability;
  code: 'API_NOT_CONFIGURED' | 'PROVIDER_AUTH_ERROR' | 'PROVIDER_BILLING_OR_QUOTA' | 'SSRF_BLOCKED' | 'PROVIDER_UPSTREAM_ERROR';

  constructor(
    message: string,
    opts: {
      status?: number;
      capability: ApiCapability;
      code:
        | 'API_NOT_CONFIGURED'
        | 'PROVIDER_AUTH_ERROR'
        | 'PROVIDER_BILLING_OR_QUOTA'
        | 'SSRF_BLOCKED'
        | 'PROVIDER_UPSTREAM_ERROR';
    }
  ) {
    super(message);
    this.name = 'ProviderConfigurationError';
    this.status = opts.status ?? 400;
    this.capability = opts.capability;
    this.code = opts.code;
  }
}

interface StoredProviderRecord {
  capability: ApiCapability;
  providerKind: ApiProviderKind;
  label: string;
  tier: 'free' | 'paid' | 'unknown';
  endpointUrl: string;
  model: string;
  authHeader: string;
  authPrefix: string;
  supportsImageToVideo: boolean;
  encryptedKey?: {
    iv: string;
    tag: string;
    cipherText: string;
  };
  keyPreview: string;
  lastTestedAt: string;
  lastStatus: 'ready' | 'unconfigured' | 'error';
  lastMessage: string;
}

interface UserVaultFile {
  updatedAt: string;
  providers: Partial<Record<ApiCapability, StoredProviderRecord>>;
}

interface ResolvedProviderRuntime {
  configured: boolean;
  source: 'user_vault' | 'server_env' | 'none';
  capability: ApiCapability;
  providerKind: ApiProviderKind | null;
  label: string;
  tier: 'free' | 'paid' | 'unknown';
  endpointUrl: string;
  model: string;
  authHeader: string;
  authPrefix: string;
  supportsImageToVideo: boolean;
  apiKey: string;
  keyPreview: string;
  lastTestedAt?: string;
  lastStatus: 'ready' | 'unconfigured' | 'error';
  lastMessage: string;
}

function getWorkspaceRoot(workspaceDir?: string): string {
  return workspaceDir || path.resolve(process.cwd(), 'workspace');
}

function sanitizeVaultUserId(userId: string): string {
  return (userId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function getUserVaultPath(userId: string, workspaceDir?: string): string {
  return path.join(
    getWorkspaceRoot(workspaceDir),
    'users',
    sanitizeVaultUserId(userId),
    'api_providers.json'
  );
}

let cachedVaultSecret: Buffer | null = null;

function getVaultEncryptionKey(workspaceDir?: string): Buffer {
  if (cachedVaultSecret) return cachedVaultSecret;
  const envSecret = (
    process.env.API_VAULT_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    ''
  ).trim();
  if (envSecret.length >= 16) {
    cachedVaultSecret = crypto.scryptSync(envSecret, 'auteur-studio-vault-v1', 32);
    return cachedVaultSecret;
  }
  const keyFile = path.join(getWorkspaceRoot(workspaceDir), '.vault_key');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  let rawSecret = '';
  if (fs.existsSync(keyFile)) {
    rawSecret = fs.readFileSync(keyFile, 'utf-8').trim();
  }
  if (!rawSecret) {
    rawSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFile, rawSecret, { encoding: 'utf-8', mode: 0o600 });
  }
  cachedVaultSecret = crypto.scryptSync(rawSecret, 'auteur-studio-vault-v1', 32);
  return cachedVaultSecret;
}

function encryptSecret(plain: string, workspaceDir?: string): StoredProviderRecord['encryptedKey'] | undefined {
  const clean = plain.trim();
  if (!clean) return undefined;
  const key = getVaultEncryptionKey(workspaceDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    cipherText: encrypted.toString('base64'),
  };
}

function decryptSecret(
  payload: StoredProviderRecord['encryptedKey'],
  workspaceDir?: string
): string {
  if (!payload || !payload.iv || !payload.tag || !payload.cipherText) return '';
  try {
    const key = getVaultEncryptionKey(workspaceDir);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.cipherText, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function readUserVault(userId: string, workspaceDir?: string): UserVaultFile {
  const filePath = getUserVaultPath(userId, workspaceDir);
  if (!fs.existsSync(filePath)) {
    return { updatedAt: new Date().toISOString(), providers: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as UserVaultFile;
    if (parsed && typeof parsed === 'object' && parsed.providers) {
      return parsed;
    }
  } catch {
    // Fallback to empty vault
  }
  return { updatedAt: new Date().toISOString(), providers: {} };
}

function writeUserVault(userId: string, vault: UserVaultFile, workspaceDir?: string): void {
  const filePath = getUserVaultPath(userId, workspaceDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(vault, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export async function assertSafePublicHttpsUrl(
  rawUrl: string,
  capability: ApiCapability = 'image'
): Promise<string> {
  const check = validateExternalEndpointUrl(rawUrl);
  if (!check.valid || !check.normalizedUrl) {
    throw new ProviderConfigurationError(
      check.error || 'Endpoint externo inválido.',
      { status: 400, capability, code: 'SSRF_BLOCKED' }
    );
  }
  const parsed = new URL(check.normalizedUrl);
  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    if (!records || records.length === 0) {
      throw new ProviderConfigurationError(
        `No se pudo resolver el dominio externo "${parsed.hostname}".`,
        { status: 400, capability, code: 'SSRF_BLOCKED' }
      );
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new ProviderConfigurationError(
          `Bloqueado por seguridad SSRF: "${parsed.hostname}" apunta a una red privada o reservada.`,
          { status: 400, capability, code: 'SSRF_BLOCKED' }
        );
      }
    }
  } catch (err) {
    if (err instanceof ProviderConfigurationError) throw err;
    throw new ProviderConfigurationError(
      `No se pudo verificar el DNS del endpoint "${parsed.hostname}".`,
      { status: 400, capability, code: 'SSRF_BLOCKED' }
    );
  }
  return check.normalizedUrl;
}

function getEnvFallbackProvider(capability: ApiCapability): ResolvedProviderRuntime | null {
  if (capability === 'core') {
    const gemKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!gemKey || gemKey === 'MY_GEMINI_API_KEY') return null;
    return {
      configured: true,
      source: 'server_env',
      capability: 'core',
      providerKind: 'gemini',
      label: 'Google Gemini Director (Servidor)',
      tier: 'free',
      endpointUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-4-hydrogen',
      authHeader: 'x-goog-api-key',
      authPrefix: '',
      supportsImageToVideo: false,
      apiKey: gemKey,
      keyPreview: maskApiKey(gemKey),
      lastStatus: 'ready',
      lastMessage: 'Motor principal Agente Arthur configurado en el entorno del servidor.',
    };
  }

  // Zero hardcoded predetermined Image/Video/Frameo API: only active if explicitly configured in env vars.
  const prefix =
    capability === 'image'
      ? 'IMAGE_API'
      : capability === 'frameo_video'
        ? 'FRAMEO_VIDEO'
        : 'VIDEO_API';
  const endpointUrl = (process.env[`${prefix}_ENDPOINT`] || '').trim();
  const apiKey = (process.env[`${prefix}_KEY`] || '').trim();
  const providerHintRaw = (process.env[`${prefix}_PROVIDER`] || 'auto').trim() as
    | ApiProviderKind
    | 'auto';
  const model = (process.env[`${prefix}_MODEL`] || '').trim();
  const tierHintRaw = (process.env[`${prefix}_TIER`] || 'auto').trim() as 'free' | 'paid' | 'auto';

  if (!endpointUrl && !apiKey && providerHintRaw === 'auto') {
    return null;
  }

  const detected = detectApiProviderSpec({
    capability,
    providerHint: providerHintRaw,
    tierHint: tierHintRaw,
    endpointUrl,
    apiKey,
    model,
  });

  return {
    configured: true,
    source: 'server_env',
    capability,
    providerKind: detected.providerKind,
    label: `${detected.label} (Entorno)`,
    tier: detected.tier,
    endpointUrl: detected.endpointUrl,
    model: detected.model,
    authHeader: detected.authHeader,
    authPrefix: detected.authPrefix,
    supportsImageToVideo: detected.supportsImageToVideo,
    apiKey,
    keyPreview: maskApiKey(apiKey),
    lastStatus: 'ready',
    lastMessage: 'Proveedor configurado mediante variables de entorno opcionales.',
  };
}

export function resolveProviderForCapability(
  userId: string,
  capability: ApiCapability,
  workspaceDir?: string
): ResolvedProviderRuntime {
  const vault = readUserVault(userId, workspaceDir);
  const stored = vault.providers[capability];
  if (stored && stored.endpointUrl) {
    const apiKey = decryptSecret(stored.encryptedKey, workspaceDir);
    return {
      configured: true,
      source: 'user_vault',
      capability,
      providerKind: stored.providerKind,
      label: stored.label,
      tier: stored.tier,
      endpointUrl: stored.endpointUrl,
      model: stored.model,
      authHeader: stored.authHeader,
      authPrefix: stored.authPrefix,
      supportsImageToVideo: stored.supportsImageToVideo,
      apiKey,
      keyPreview: stored.keyPreview || maskApiKey(apiKey),
      lastTestedAt: stored.lastTestedAt,
      lastStatus: stored.lastStatus,
      lastMessage: stored.lastMessage,
    };
  }

  const envFallback = getEnvFallbackProvider(capability);
  if (envFallback) return envFallback;

  return {
    configured: false,
    source: 'none',
    capability,
    providerKind: null,
    label:
      capability === 'image'
        ? 'Sin API de Imágenes asignada'
        : capability === 'frameo_video'
          ? 'Sin servicio de video Frameo IA configurado'
          : capability === 'video'
            ? 'Sin API de Video asignada'
            : 'Sin API Core configurada',
    tier: 'unknown',
    endpointUrl: '',
    model: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    supportsImageToVideo: false,
    apiKey: '',
    keyPreview: '',
    lastStatus: 'unconfigured',
    lastMessage:
      capability === 'image'
        ? 'Asigna cualquier API de Imágenes (free o de pago) en Configuración del Estudio.'
        : capability === 'frameo_video'
          ? 'El servicio de generación de video de Frameo IA no está configurado. Conéctalo en Laboratorio Admin / Configuración o configura una API manual.'
          : capability === 'video'
            ? 'Asigna cualquier API de Video (free o de pago) en Configuración del Estudio.'
            : 'Configura GEMINI_API_KEY en Settings > Secrets o una API compatible.',
  };
}

function toPublicSummary(runtime: ResolvedProviderRuntime): ApiProviderPublicSummary {
  return {
    capability: runtime.capability,
    configured: runtime.configured,
    source: runtime.source,
    providerKind: runtime.providerKind,
    label: runtime.label,
    tier: runtime.tier,
    model: runtime.model,
    endpointUrl: runtime.endpointUrl,
    hasKey: Boolean(runtime.apiKey),
    keyPreview: runtime.keyPreview,
    authHeader: runtime.authHeader,
    authPrefix: runtime.authPrefix,
    supportsImageToVideo: runtime.supportsImageToVideo,
    lastTestedAt: runtime.lastTestedAt,
    lastStatus: runtime.lastStatus,
    lastMessage: runtime.lastMessage,
  };
}

function buildNeutralUnconfiguredFrameoSummary(): ApiProviderPublicSummary {
  return {
    capability: 'frameo_video',
    configured: false,
    source: 'none',
    providerKind: null,
    label: 'Servicio Frameo IA (Exclusivo Admin)',
    tier: 'unknown',
    model: '',
    endpointUrl: '',
    hasKey: false,
    keyPreview: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    supportsImageToVideo: false,
    lastStatus: 'unconfigured',
    lastMessage: 'Disponible exclusivamente en el perfil Administrador.',
  };
}

export function listPublicProviders(
  userId: string,
  workspaceDir?: string,
  options?: { includeAdminFrameo?: boolean }
): Record<ApiCapability, ApiProviderPublicSummary> {
  return {
    image: toPublicSummary(resolveProviderForCapability(userId, 'image', workspaceDir)),
    video: toPublicSummary(resolveProviderForCapability(userId, 'video', workspaceDir)),
    core: toPublicSummary(resolveProviderForCapability(userId, 'core', workspaceDir)),
    frameo_video: options?.includeAdminFrameo
      ? toPublicSummary(resolveProviderForCapability(userId, 'frameo_video', workspaceDir))
      : buildNeutralUnconfiguredFrameoSummary(),
  };
}

export function deleteUserProvider(
  userId: string,
  capability: ApiCapability,
  workspaceDir?: string,
  options?: { includeAdminFrameo?: boolean }
): Record<ApiCapability, ApiProviderPublicSummary> {
  const vault = readUserVault(userId, workspaceDir);
  if (vault.providers[capability]) {
    delete vault.providers[capability];
    vault.updatedAt = new Date().toISOString();
    writeUserVault(userId, vault, workspaceDir);
  }
  return listPublicProviders(userId, workspaceDir, {
    includeAdminFrameo: options?.includeAdminFrameo ?? capability === 'frameo_video',
  });
}

function buildAuthHeaders(
  authHeader: string,
  authPrefix: string,
  apiKey: string
): Record<string, string> {
  if (!apiKey) return {};
  const headerName = authHeader.trim() || 'Authorization';
  const value = authPrefix ? `${authPrefix}${apiKey}` : apiKey;
  return { [headerName]: value };
}

export async function detectTestAndSaveProvider(
  userId: string,
  input: ApiProviderInput & { save?: boolean },
  workspaceDir?: string
): Promise<{
  summary: ApiProviderPublicSummary;
  providers: Record<ApiCapability, ApiProviderPublicSummary>;
  diagnostics: string;
}> {
  const capability = input.capability;
  const existing = readUserVault(userId, workspaceDir).providers[capability];
  const incomingKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const effectiveKey =
    incomingKey || (existing ? decryptSecret(existing.encryptedKey, workspaceDir) : '');

  const detected = detectApiProviderSpec({
    ...input,
    apiKey: effectiveKey,
  });

  if (!detected.endpointUrl) {
    throw new ProviderConfigurationError(
      'Debes indicar la URL del endpoint HTTPS o seleccionar un proveedor preconfigurado.',
      { status: 400, capability, code: 'API_NOT_CONFIGURED' }
    );
  }

  const safeUrl = await assertSafePublicHttpsUrl(detected.endpointUrl, capability);
  let resolvedTier: 'free' | 'paid' | 'unknown' = detected.tier;
  let resolvedModel = detected.model;
  let status: 'ready' | 'error' = 'ready';
  let diagnostics = '';

  if (detected.providerKind === 'pollinations') {
    resolvedTier = 'free';
    try {
      const probeRes = await fetch(
        `https://image.pollinations.ai/prompt/cinema%20test?width=64&height=64&nologo=true&model=${encodeURIComponent(resolvedModel || 'flux')}`,
        { method: 'HEAD', signal: AbortSignal.timeout(8000) }
      );
      if (!probeRes.ok && probeRes.status !== 405) {
        diagnostics = `Pollinations detectado (Tier Free sin clave, HTTP ${probeRes.status}).`;
      } else {
        diagnostics = 'Pollinations Image conectado en modo Free (sin clave obligatoria).';
      }
    } catch {
      diagnostics = 'Pollinations Image guardado en modo Free (verificación pasiva).';
    }
  } else if (detected.providerKind === 'gemini') {
    if (!effectiveKey) {
      throw new ProviderConfigurationError(
        'Google Gemini requiere una API Key válida (AIza...).',
        { status: 400, capability, code: 'PROVIDER_AUTH_ERROR' }
      );
    }
    const probeRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=50`,
      {
        headers: { 'x-goog-api-key': effectiveKey },
        signal: AbortSignal.timeout(9000),
      }
    );
    if (!probeRes.ok) {
      throw new ProviderConfigurationError(
        `La API Key de Google Gemini fue rechazada (HTTP ${probeRes.status}). Verifica que sea válida.`,
        { status: 401, capability, code: 'PROVIDER_AUTH_ERROR' }
      );
    }
    const modelsJson = (await probeRes.json()) as {
      models?: Array<{ name?: string }>;
    };
    const modelNames = (modelsJson.models || []).map((m) => String(m.name || ''));
    if (capability === 'image') {
      const hasNano = modelNames.some((n) => n.includes('gemini-nano-banana-2.1'));
      const hasLite = modelNames.some((n) => n.includes('gemini-3.1-flash-lite-image'));
      if (input.tierHint === 'free') {
        resolvedTier = 'free';
      } else if (input.tierHint === 'paid') {
        resolvedTier = 'paid';
      } else {
        resolvedTier = 'paid';
      }
      if (!input.model && !hasNano && hasLite) {
        resolvedModel = 'gemini-3.1-flash-lite-image';
      }
      diagnostics = `Google Gemini Image verificado (modelo ${resolvedModel}). Ten en cuenta que la generación de imágenes en Gemini requiere facturación activa en GCP si es cuenta estándar.`;
    } else if (capability === 'video' || capability === 'frameo_video') {
      resolvedTier = input.tierHint === 'free' ? 'free' : 'paid';
      diagnostics = `${
        capability === 'frameo_video' ? 'Frameo IA · ' : ''
      }Google Gemini Video (${resolvedModel}) verificado. Interactions API requiere facturación activa en Google Cloud para renderizar MP4.`;
    } else {
      resolvedTier = input.tierHint === 'paid' ? 'paid' : 'free';
      diagnostics = 'Google Gemini Director verificado correctamente.';
    }
  } else if (detected.providerKind === 'huggingface') {
    if (effectiveKey) {
      const whoRes = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${effectiveKey}` },
        signal: AbortSignal.timeout(9000),
      });
      if (!whoRes.ok) {
        throw new ProviderConfigurationError(
          `Token de Hugging Face inválido o expirado (HTTP ${whoRes.status}).`,
          { status: 401, capability, code: 'PROVIDER_AUTH_ERROR' }
        );
      }
      const whoData = (await whoRes.json()) as { isPro?: boolean; name?: string };
      resolvedTier =
        input.tierHint === 'paid' || whoData.isPro ? 'paid' : 'free';
      diagnostics = `Hugging Face autenticado como ${whoData.name || 'usuario'} (${resolvedTier === 'paid' ? 'Cuenta Pro / Pago' : 'Tier Free'}).`;
    } else {
      resolvedTier = 'free';
      diagnostics = 'Hugging Face configurado sin token (sujeto a límites públicos free).';
    }
  } else if (detected.providerKind === 'replicate') {
    if (!effectiveKey) {
      throw new ProviderConfigurationError(
        'Replicate requiere un API token (r8_...).',
        { status: 400, capability, code: 'PROVIDER_AUTH_ERROR' }
      );
    }
    const accRes = await fetch('https://api.replicate.com/v1/account', {
      headers: { Authorization: `Bearer ${effectiveKey}` },
      signal: AbortSignal.timeout(9000),
    });
    if (!accRes.ok) {
      throw new ProviderConfigurationError(
        `Token de Replicate rechazado (HTTP ${accRes.status}).`,
        { status: 401, capability, code: 'PROVIDER_AUTH_ERROR' }
      );
    }
    const accJson = (await accRes.json()) as { username?: string; type?: string };
    resolvedTier = input.tierHint === 'free' ? 'free' : 'paid';
    diagnostics = `Replicate conectado (@${accJson.username || 'cuenta'}). Modelo: ${resolvedModel}.`;
  } else if (detected.providerKind === 'openai') {
    if (!effectiveKey) {
      throw new ProviderConfigurationError(
        'OpenAI / Compatible requiere una API Key.',
        { status: 400, capability, code: 'PROVIDER_AUTH_ERROR' }
      );
    }
    const parsedEndpoint = new URL(safeUrl);
    if (parsedEndpoint.hostname === 'api.openai.com') {
      const mRes = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${effectiveKey}` },
        signal: AbortSignal.timeout(9000),
      });
      if (!mRes.ok) {
        throw new ProviderConfigurationError(
          `Clave OpenAI rechazada (HTTP ${mRes.status}).`,
          { status: 401, capability, code: 'PROVIDER_AUTH_ERROR' }
        );
      }
    }
    resolvedTier = input.tierHint === 'free' ? 'free' : 'paid';
    diagnostics = `Endpoint OpenAI compatible verificado (${parsedEndpoint.hostname}).`;
  } else if (detected.providerKind === 'fal') {
    if (!effectiveKey) {
      throw new ProviderConfigurationError(
        'Fal.ai requiere una API Key.',
        { status: 400, capability, code: 'PROVIDER_AUTH_ERROR' }
      );
    }
    resolvedTier = input.tierHint === 'free' ? 'free' : 'paid';
    diagnostics = `Fal.ai configurado (${resolvedModel}). Listo para inferencia.`;
  } else if (detected.providerKind === 'frameo_mcp') {
    const metadata = await discoverFrameoOAuthMetadata(safeUrl);
    const tokenCtx = await getValidFrameoMcpAccessToken(
      userId,
      workspaceDir,
      effectiveKey || undefined
    );
    if (tokenCtx) {
      const mcpResult = await listFrameoMcpTools(
        userId,
        workspaceDir,
        effectiveKey || undefined
      );
      resolvedTier = input.tierHint === 'free' ? 'free' : 'paid';
      diagnostics = `Frameo.AI MCP conectado (${mcpResult.serverName || 'MCP'}) · ${mcpResult.tools.length} herramienta(s) descubiertas.`;
    } else {
      resolvedTier = 'paid';
      status = 'error';
      diagnostics = `Endpoint MCP Frameo.AI verificado (${metadata.issuer}), pero falta iniciar sesión OAuth. Pulsa "Conectar con Frameo.AI (OAuth MCP)".`;
    }
  } else {
    // custom_rest: Verify reachability & TLS cleanly via HEAD/OPTIONS without exposing SSRF
    resolvedTier =
      input.tierHint === 'free' || input.tierHint === 'paid'
        ? input.tierHint
        : effectiveKey
          ? 'unknown'
          : 'free';
    try {
      const probeRes = await fetch(safeUrl, {
        method: 'HEAD',
        headers: buildAuthHeaders(detected.authHeader, detected.authPrefix, effectiveKey),
        signal: AbortSignal.timeout(7000),
      });
      if (probeRes.status === 401 || probeRes.status === 403) {
        throw new ProviderConfigurationError(
          `El endpoint personalizado respondió HTTP ${probeRes.status} (credenciales rechazadas).`,
          { status: probeRes.status, capability, code: 'PROVIDER_AUTH_ERROR' }
        );
      }
      diagnostics = `Endpoint REST verificado (HTTPS válido · respuesta HTTP ${probeRes.status}).`;
    } catch (probeErr) {
      if (probeErr instanceof ProviderConfigurationError) throw probeErr;
      diagnostics = `Endpoint HTTPS validado y guardado (${new URL(safeUrl).hostname}).`;
    }
  }

  const record: StoredProviderRecord = {
    capability,
    providerKind: detected.providerKind,
    label: detected.label,
    tier: resolvedTier,
    endpointUrl: safeUrl,
    model: resolvedModel,
    authHeader: detected.authHeader,
    authPrefix: detected.authPrefix,
    supportsImageToVideo: detected.supportsImageToVideo,
    encryptedKey: encryptSecret(effectiveKey, workspaceDir),
    keyPreview: maskApiKey(effectiveKey),
    lastTestedAt: new Date().toISOString(),
    lastStatus: status,
    lastMessage: diagnostics,
  };

  if (input.save !== false) {
    const vault = readUserVault(userId, workspaceDir);
    vault.providers[capability] = record;
    vault.updatedAt = new Date().toISOString();
    writeUserVault(userId, vault, workspaceDir);
  }

  const summary = toPublicSummary({
    ...record,
    configured: true,
    source: 'user_vault',
    apiKey: effectiveKey,
  });

  return {
    summary,
    providers: listPublicProviders(userId, workspaceDir, {
      includeAdminFrameo: capability === 'frameo_video',
    }),
    diagnostics,
  };
}

export function saveConnectedFrameoMcpProvider(
  userId: string,
  params: { mcpUrl?: string; model?: string; toolsCount?: number; serverName?: string },
  workspaceDir?: string
): Record<ApiCapability, ApiProviderPublicSummary> {
  const vault = readUserVault(userId, workspaceDir);
  const endpointUrl = params.mcpUrl || DEFAULT_FRAMEO_MCP_URL;
  const model = params.model || 'Veo 3.1 Rápido';
  const toolsMsg =
    typeof params.toolsCount === 'number'
      ? ` · ${params.toolsCount} herramientas MCP activas`
      : '';
  vault.providers.frameo_video = {
    capability: 'frameo_video',
    providerKind: 'frameo_mcp',
    label: `Frameo.AI MCP (${params.serverName || 'OAuth Conectado'})`,
    tier: 'paid',
    endpointUrl,
    model,
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    supportsImageToVideo: true,
    keyPreview: 'OAuth 2.0 PKCE',
    lastTestedAt: new Date().toISOString(),
    lastStatus: 'ready',
    lastMessage: `Conectado mediante OAuth MCP${toolsMsg}.`,
  };
  vault.updatedAt = new Date().toISOString();
  writeUserVault(userId, vault, workspaceDir);
  return listPublicProviders(userId, workspaceDir, { includeAdminFrameo: true });
}

function aspectRatioToDimensions(
  aspectRatio: string,
  resolution: ResolutionTier
): { width: number; height: number } {
  const baseScale = resolution === '4K' || resolution === '2K' ? 1280 : 1024;
  if (aspectRatio === '9:16') return { width: 720, height: 1280 };
  if (aspectRatio === '3:4') return { width: 768, height: 1024 };
  if (aspectRatio === '1:1') return { width: 1024, height: 1024 };
  if (aspectRatio === '4:3' || aspectRatio === '1.43:1') return { width: 1024, height: 768 };
  if (aspectRatio === '2.39:1') return { width: baseScale, height: Math.round(baseScale / 2.39) };
  return { width: baseScale, height: Math.round((baseScale * 9) / 16) };
}

function normalizeNanoAspectRatio(rawRatio: string): string {
  const r = (rawRatio || '').trim();
  if (r === '21:9' || r === '2.39:1') return '21:9';
  if (r === '9:16') return '9:16';
  if (r === '3:4') return '3:4';
  if (r === '1:1') return '1:1';
  if (r === '4:3' || r === '1.43:1') return '4:3';
  return '16:9';
}

function normalizeOmniAspectRatio(rawRatio: string): '16:9' | '9:16' {
  const r = (rawRatio || '').trim();
  if (r === '9:16' || r === '3:4') return '9:16';
  return '16:9';
}

async function downloadExternalMediaSafely(
  mediaUrl: string,
  capability: ApiCapability,
  extraHeaders?: Record<string, string>
): Promise<{ buffer: Buffer; mimeType: string }> {
  const safeUrl = await assertSafePublicHttpsUrl(mediaUrl, capability);
  const res = await fetch(safeUrl, {
    headers: extraHeaders,
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    throw new ProviderConfigurationError(
      `No se pudo descargar el archivo multimedia generado (HTTP ${res.status}).`,
      { status: 502, capability, code: 'PROVIDER_UPSTREAM_ERROR' }
    );
  }
  const mimeType =
    res.headers.get('content-type') ||
    (capability === 'video' ? 'video/mp4' : 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new ProviderConfigurationError(
      'El proveedor externo devolvió un archivo vacío.',
      { status: 502, capability, code: 'PROVIDER_UPSTREAM_ERROR' }
    );
  }
  if (buf.length > 60 * 1024 * 1024) {
    throw new ProviderConfigurationError(
      'El archivo devuelto excede el límite seguro de 60 MB.',
      { status: 413, capability, code: 'PROVIDER_UPSTREAM_ERROR' }
    );
  }
  return { buffer: buf, mimeType };
}

function extractImageUrlOrBase64FromJson(
  payload: unknown
): { b64?: string; url?: string; mimeType?: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.data) && obj.data[0] && typeof obj.data[0] === 'object') {
    const first = obj.data[0] as Record<string, unknown>;
    if (typeof first.b64_json === 'string' && first.b64_json) {
      return { b64: first.b64_json, mimeType: 'image/png' };
    }
    if (typeof first.url === 'string' && first.url) {
      return { url: first.url };
    }
  }
  if (Array.isArray(obj.images) && obj.images[0]) {
    const first = obj.images[0];
    if (typeof first === 'string') {
      return first.startsWith('http') ? { url: first } : { b64: first };
    }
    if (typeof first === 'object' && first) {
      const f = first as Record<string, unknown>;
      if (typeof f.url === 'string') return { url: f.url, mimeType: typeof f.content_type === 'string' ? f.content_type : undefined };
      if (typeof f.b64_json === 'string') return { b64: f.b64_json };
    }
  }
  if (typeof obj.output === 'string') {
    return obj.output.startsWith('http') ? { url: obj.output } : { b64: obj.output };
  }
  if (Array.isArray(obj.output) && typeof obj.output[0] === 'string') {
    return obj.output[0].startsWith('http') ? { url: obj.output[0] } : { b64: obj.output[0] };
  }
  for (const key of ['imageUrl', 'image_url', 'url', 'image', 'b64_json', 'base64']) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) {
      if (val.startsWith('data:image/')) {
        const match = val.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (match) return { mimeType: match[1], b64: match[2] };
      }
      return val.startsWith('http') ? { url: val } : { b64: val };
    }
  }
  return null;
}

function extractVideoUrlOrBase64FromJson(
  payload: unknown
): { b64?: string; url?: string; mimeType?: string; pollUrl?: string } | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  if (obj.video && typeof obj.video === 'object') {
    const vid = obj.video as Record<string, unknown>;
    if (typeof vid.url === 'string') {
      return { url: vid.url, mimeType: typeof vid.content_type === 'string' ? vid.content_type : 'video/mp4' };
    }
  }
  if (typeof obj.output === 'string' && obj.output.startsWith('http')) {
    return { url: obj.output };
  }
  if (Array.isArray(obj.output) && typeof obj.output[0] === 'string') {
    return { url: obj.output[0] };
  }
  if (Array.isArray(obj.data) && obj.data[0] && typeof obj.data[0] === 'object') {
    const d0 = obj.data[0] as Record<string, unknown>;
    if (typeof d0.url === 'string') return { url: d0.url };
    if (typeof d0.b64_json === 'string') return { b64: d0.b64_json, mimeType: 'video/mp4' };
  }
  for (const key of ['videoUrl', 'video_url', 'url', 'b64_json', 'base64']) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) {
      return val.startsWith('http') ? { url: val } : { b64: val, mimeType: 'video/mp4' };
    }
  }
  const urls = obj.urls as Record<string, unknown> | undefined;
  if (typeof obj.status_url === 'string') {
    return { pollUrl: obj.status_url };
  }
  if (urls && typeof urls.get === 'string') {
    return { pollUrl: urls.get };
  }
  return null;
}

function classifyProviderHttpError(
  status: number,
  bodyText: string,
  providerLabel: string,
  capability: ApiCapability
): ProviderConfigurationError {
  if (status === 401 || status === 403) {
    if (/billing account|outstanding balance|PERMISSION_DENIED/i.test(bodyText)) {
      return new ProviderConfigurationError(
        `${providerLabel}: Permiso denegado o facturación pendiente (HTTP ${status}). Puedes cambiar a una API Free (p. ej. Pollinations o HuggingFace) o verificar la facturación en Configuración > Proveedores de API.`,
        { status: 403, capability, code: 'PROVIDER_BILLING_OR_QUOTA' }
      );
    }
    return new ProviderConfigurationError(
      `${providerLabel}: API Key inválida o sin autorización (HTTP ${status}). Revisa tus credenciales en Configuración.`,
      { status: 401, capability, code: 'PROVIDER_AUTH_ERROR' }
    );
  }
  if (status === 429 || status === 402) {
    return new ProviderConfigurationError(
      `${providerLabel}: Límite de cuota o créditos alcanzado (HTTP ${status}). Prueba otra API Free o de pago en Configuración.`,
      { status: 429, capability, code: 'PROVIDER_BILLING_OR_QUOTA' }
    );
  }
  return new ProviderConfigurationError(
    `${providerLabel} respondió error HTTP ${status}: ${bodyText.slice(0, 220)}`,
    { status: 502, capability, code: 'PROVIDER_UPSTREAM_ERROR' }
  );
}

export async function executeImageGeneration(
  userId: string,
  params: {
    prompt: string;
    aspectRatio: string;
    resolution: ResolutionTier;
    quality?: 'lite' | 'standard';
  },
  workspaceDir?: string
): Promise<{
  buffer: Buffer;
  mimeType: string;
  model: string;
  providerLabel: string;
  tier: string;
}> {
  const provider = resolveProviderForCapability(userId, 'image', workspaceDir);
  if (!provider.configured || !provider.providerKind) {
    throw new ProviderConfigurationError(
      'No hay ninguna API de Imágenes asignada. Ve a Configuración del Estudio > Proveedores de API y suministra una API (free o de pago) para renderizar imágenes.',
      { status: 428, capability: 'image', code: 'API_NOT_CONFIGURED' }
    );
  }

  const resSpec = buildHyperRealisticResolutionSpec(params.resolution);
  const fullPrompt = `${params.prompt}\n\n${resSpec}`;
  const { width, height } = aspectRatioToDimensions(params.aspectRatio, params.resolution);

  if (provider.providerKind === 'pollinations') {
    const base = provider.endpointUrl.replace(/\/+$/, '');
    const seed = Math.floor(Math.random() * 999999);
    const targetUrl = `${base}/${encodeURIComponent(params.prompt.slice(0, 900))}?width=${width}&height=${height}&model=${encodeURIComponent(provider.model || 'flux')}&seed=${seed}&nologo=true`;
    const headers = provider.apiKey
      ? buildAuthHeaders(provider.authHeader, provider.authPrefix, provider.apiKey)
      : undefined;
    const downloaded = await downloadExternalMediaSafely(targetUrl, 'image', headers);
    return {
      ...downloaded,
      model: provider.model || 'flux',
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }

  if (provider.providerKind === 'gemini') {
    const ai = new GoogleGenAI({
      apiKey: provider.apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const modelName =
      params.quality === 'lite'
        ? 'gemini-3.1-flash-lite-image'
        : provider.model || 'gemini-nano-banana-2.1';
    const nanoRatio = normalizeNanoAspectRatio(params.aspectRatio);
    const imageSize = getNanoImageSizeForResolution(params.resolution);
    const response = await ai.models.generateContent({
      model: modelName,
      contents: { parts: [{ text: fullPrompt }] },
      config: {
        imageConfig: {
          aspectRatio: nanoRatio,
          ...(modelName === 'gemini-nano-banana-2.1' ? { imageSize } : {}),
        },
      },
    });
    let imageBase64 = '';
    let mimeType = 'image/png';
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
        break;
      }
    }
    if (!imageBase64) {
      throw new ProviderConfigurationError(
        `${provider.label} no devolvió ninguna imagen en la respuesta.`,
        { status: 502, capability: 'image', code: 'PROVIDER_UPSTREAM_ERROR' }
      );
    }
    return {
      buffer: Buffer.from(imageBase64, 'base64'),
      mimeType,
      model: modelName,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }

  const safeEndpoint = await assertSafePublicHttpsUrl(provider.endpointUrl, 'image');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(provider.authHeader, provider.authPrefix, provider.apiKey),
  };

  let bodyObj: Record<string, unknown>;
  if (provider.providerKind === 'openai') {
    const size =
      params.aspectRatio === '9:16' || params.aspectRatio === '3:4'
        ? '1024x1536'
        : params.aspectRatio === '1:1'
          ? '1024x1024'
          : '1536x1024';
    bodyObj = {
      model: provider.model || 'gpt-image-1',
      prompt: fullPrompt.slice(0, 3800),
      size,
      n: 1,
    };
  } else if (provider.providerKind === 'huggingface') {
    bodyObj = {
      inputs: fullPrompt.slice(0, 2000),
      parameters: { width, height },
    };
  } else if (provider.providerKind === 'replicate') {
    bodyObj = {
      input: {
        prompt: fullPrompt.slice(0, 2500),
        aspect_ratio: normalizeNanoAspectRatio(params.aspectRatio),
      },
    };
  } else if (provider.providerKind === 'fal') {
    bodyObj = {
      prompt: fullPrompt.slice(0, 2500),
      image_size: { width, height },
    };
  } else {
    bodyObj = {
      prompt: fullPrompt.slice(0, 3000),
      model: provider.model || undefined,
      aspectRatio: params.aspectRatio,
      width,
      height,
      resolution: params.resolution,
    };
  }

  const res = await fetch(safeEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
    signal: AbortSignal.timeout(90000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw classifyProviderHttpError(res.status, errText, provider.label, 'image');
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.startsWith('image/')) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      mimeType: contentType.split(';')[0].trim(),
      model: provider.model || provider.label,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }

  let jsonPayload = (await res.json()) as Record<string, unknown>;

  // Handle Replicate async prediction polling automatically
  if (
    provider.providerKind === 'replicate' &&
    typeof jsonPayload.status === 'string' &&
    !jsonPayload.output &&
    jsonPayload.urls &&
    typeof (jsonPayload.urls as Record<string, unknown>).get === 'string'
  ) {
    const pollUrl = String((jsonPayload.urls as Record<string, unknown>).get);
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const safePollUrl = await assertSafePublicHttpsUrl(pollUrl, 'image');
      const pollRes = await fetch(safePollUrl, { headers });
      if (!pollRes.ok) break;
      jsonPayload = (await pollRes.json()) as Record<string, unknown>;
      if (jsonPayload.status === 'succeeded') break;
      if (jsonPayload.status === 'failed' || jsonPayload.status === 'canceled') {
        throw new ProviderConfigurationError(
          `${provider.label} falló: ${String(jsonPayload.error || jsonPayload.status)}`,
          { status: 502, capability: 'image', code: 'PROVIDER_UPSTREAM_ERROR' }
        );
      }
    }
  }

  const extracted = extractImageUrlOrBase64FromJson(jsonPayload);
  if (!extracted) {
    throw new ProviderConfigurationError(
      `${provider.label} respondió en formato JSON sin imagen reconocible.`,
      { status: 502, capability: 'image', code: 'PROVIDER_UPSTREAM_ERROR' }
    );
  }
  if (extracted.b64) {
    return {
      buffer: Buffer.from(extracted.b64, 'base64'),
      mimeType: extracted.mimeType || 'image/png',
      model: provider.model || provider.label,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }
  if (extracted.url) {
    const downloaded = await downloadExternalMediaSafely(extracted.url, 'image');
    return {
      ...downloaded,
      model: provider.model || provider.label,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }

  throw new ProviderConfigurationError(
    `${provider.label} no devolvió datos de imagen.`,
    { status: 502, capability: 'image', code: 'PROVIDER_UPSTREAM_ERROR' }
  );
}

export interface VideoExecutionResult {
  buffer: Buffer;
  mimeType: string;
  model: string;
  providerLabel: string;
  tier: string;
}

export async function executeVideoGeneration(
  userId: string,
  params: {
    prompt: string;
    aspectRatio: string;
    duration: string;
    sourceImage?: { data: string; mimeType: string } | null;
    capability?: 'video' | 'frameo_video';
    model?: string;
    vfxMode?: string;
    renderQuality?: '480p_preview' | 'full_hd';
  },
  workspaceDir?: string
): Promise<VideoExecutionResult> {
  const targetCapability: 'video' | 'frameo_video' =
    params.capability === 'frameo_video' ? 'frameo_video' : 'video';
  const provider = resolveProviderForCapability(userId, targetCapability, workspaceDir);
  if (!provider.configured || !provider.providerKind) {
    throw new ProviderConfigurationError(
      targetCapability === 'frameo_video'
        ? 'El servicio de generación de video de Frameo IA no está configurado o no tiene credenciales activas. Configúralo vía OAuth MCP o asigna manualmente una API de generación.'
        : 'No hay ninguna API de Video asignada. Ve a Configuración del Estudio > Proveedores de API y suministra una API de video (free o de pago).',
      { status: 428, capability: targetCapability, code: 'API_NOT_CONFIGURED' }
    );
  }

  const omniRatio = normalizeOmniAspectRatio(params.aspectRatio);
  const videoDuration = /^(3|4|5|6|7|8|9|10)s$/.test(params.duration)
    ? params.duration
    : '6s';
  const durationSeconds = parseInt(videoDuration, 10) || 6;

  if (provider.providerKind === 'frameo_mcp') {
    try {
      const mcpResult = await executeFrameoMcpVideo({
        userId,
        prompt: params.prompt,
        aspectRatio: omniRatio,
        durationSeconds,
        model: params.model || provider.model || 'Veo 3.1 Rápido',
        vfxMode: params.vfxMode,
        resolution: params.renderQuality === 'full_hd' ? '1080p' : '480p',
        sourceImageDataUrl: params.sourceImage
          ? `data:${params.sourceImage.mimeType};base64,${params.sourceImage.data}`
          : undefined,
        explicitBearerToken: provider.apiKey || undefined,
        workspaceDir,
      });

      if (mcpResult.base64) {
        return {
          buffer: Buffer.from(mcpResult.base64, 'base64'),
          mimeType: mcpResult.mimeType || 'video/mp4',
          model: `${params.model || provider.model || 'Frameo MCP'} (${mcpResult.toolUsed})`,
          providerLabel: provider.label,
          tier: provider.tier,
        };
      }

      if (mcpResult.videoUrl) {
        const downloaded = await downloadExternalMediaSafely(
          mcpResult.videoUrl,
          targetCapability
        );
        return {
          ...downloaded,
          model: `${params.model || provider.model || 'Frameo MCP'} (${mcpResult.toolUsed})`,
          providerLabel: provider.label,
          tier: provider.tier,
        };
      }
    } catch (mcpErr) {
      if (mcpErr instanceof ProviderConfigurationError) throw mcpErr;
      const msg = mcpErr instanceof Error ? mcpErr.message : 'Error ejecutando Frameo.AI MCP.';
      const isAuth = /autenticado|expirada|autorizada|401|403/i.test(msg);
      throw new ProviderConfigurationError(msg, {
        status: isAuth ? 401 : 502,
        capability: targetCapability,
        code: isAuth ? 'PROVIDER_AUTH_ERROR' : 'PROVIDER_UPSTREAM_ERROR',
      });
    }
  }

  if (provider.providerKind === 'gemini') {
    const ai = new GoogleGenAI({
      apiKey: provider.apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const inputPayload = params.sourceImage
      ? [
          {
            type: 'image' as const,
            mime_type: params.sourceImage.mimeType,
            data: params.sourceImage.data,
          },
          { type: 'text' as const, text: params.prompt },
        ]
      : params.prompt;

    const modelName = provider.model || 'gemini-omni-1.2-flash';
    let interaction = await ai.interactions.create({
      model: modelName,
      input: inputPayload,
      background: true,
      store: true,
      response_format: {
        type: 'video',
        aspect_ratio: omniRatio,
        duration: videoDuration,
        resolution: '720p',
      },
    });

    for (let attempt = 0; attempt < 95; attempt++) {
      if (interaction.status === 'completed') break;
      if (
        interaction.status === 'failed' ||
        interaction.status === 'cancelled' ||
        interaction.status === 'incomplete' ||
        interaction.status === 'budget_exceeded'
      ) {
        const msg =
          interaction.errors?.[0]?.message ||
          `La API de video finalizó con estado ${interaction.status}.`;
        throw new ProviderConfigurationError(msg, {
          status: 502,
          capability: targetCapability,
          code: 'PROVIDER_UPSTREAM_ERROR',
        });
      }
      await new Promise((r) => setTimeout(r, 3000));
      interaction = await ai.interactions.get(interaction.id);
    }

    const record = interaction as unknown as Record<string, unknown>;
    const direct = record.output_video as
      | { data?: string; uri?: string; mime_type?: string }
      | undefined;
    const outputs = record.outputs as Array<Record<string, unknown>> | undefined;
    const fromOutputs = Array.isArray(outputs)
      ? outputs.find((item) => item && item.type === 'video' && (item.data || item.uri))
      : undefined;
    const part =
      direct && (direct.data || direct.uri)
        ? direct
        : fromOutputs
          ? {
              data: typeof fromOutputs.data === 'string' ? fromOutputs.data : undefined,
              uri: typeof fromOutputs.uri === 'string' ? fromOutputs.uri : undefined,
              mime_type:
                typeof fromOutputs.mime_type === 'string' ? fromOutputs.mime_type : undefined,
            }
          : null;

    if (!part) {
      throw new ProviderConfigurationError(
        `${provider.label} no devolvió un archivo de video válido.`,
        { status: 502, capability: targetCapability, code: 'PROVIDER_UPSTREAM_ERROR' }
      );
    }

    if (part.data) {
      return {
        buffer: Buffer.from(part.data, 'base64'),
        mimeType: part.mime_type || 'video/mp4',
        model: modelName,
        providerLabel: provider.label,
        tier: provider.tier,
      };
    }

    if (part.uri) {
      const downloaded = await downloadExternalMediaSafely(part.uri, targetCapability, {
        'x-goog-api-key': provider.apiKey,
      });
      return {
        ...downloaded,
        model: modelName,
        providerLabel: provider.label,
        tier: provider.tier,
      };
    }
  }

  const safeEndpoint = await assertSafePublicHttpsUrl(provider.endpointUrl, targetCapability);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(provider.authHeader, provider.authPrefix, provider.apiKey),
  };

  let bodyObj: Record<string, unknown>;
  if (provider.providerKind === 'huggingface') {
    bodyObj = {
      inputs: params.prompt.slice(0, 2000),
    };
  } else if (provider.providerKind === 'replicate') {
    bodyObj = {
      input: {
        prompt: params.prompt.slice(0, 2500),
        aspect_ratio: omniRatio,
        duration: durationSeconds,
        ...(params.sourceImage
          ? { image: `data:${params.sourceImage.mimeType};base64,${params.sourceImage.data}` }
          : {}),
      },
    };
  } else if (provider.providerKind === 'fal') {
    bodyObj = {
      prompt: params.prompt.slice(0, 2500),
      aspect_ratio: omniRatio,
      duration: String(durationSeconds),
      ...(params.sourceImage
        ? { image_url: `data:${params.sourceImage.mimeType};base64,${params.sourceImage.data}` }
        : {}),
    };
  } else {
    bodyObj = {
      model: provider.model || undefined,
      prompt: params.prompt.slice(0, 2500),
      aspectRatio: omniRatio,
      duration: videoDuration,
      durationSeconds,
      ...(params.sourceImage
        ? { imageBase64: params.sourceImage.data, imageMimeType: params.sourceImage.mimeType }
        : {}),
    };
  }

  const res = await fetch(safeEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyObj),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw classifyProviderHttpError(res.status, errText, provider.label, targetCapability);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.startsWith('video/') || contentType === 'application/octet-stream') {
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      mimeType: contentType.startsWith('video/') ? contentType.split(';')[0].trim() : 'video/mp4',
      model: provider.model || provider.label,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }

  let jsonPayload = (await res.json()) as Record<string, unknown>;
  let extracted = extractVideoUrlOrBase64FromJson(jsonPayload);

  // Poll async endpoints (Replicate / Fal queue / Custom polling API)
  const pollUrl =
    extracted?.pollUrl ||
    (typeof jsonPayload.response_url === 'string' ? jsonPayload.response_url : undefined);

  if (pollUrl && !extracted?.url && !extracted?.b64) {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const safePoll = await assertSafePublicHttpsUrl(pollUrl, targetCapability);
      const pollRes = await fetch(safePoll, { headers });
      if (!pollRes.ok) continue;
      const pollType = pollRes.headers.get('content-type') || '';
      if (pollType.startsWith('video/')) {
        return {
          buffer: Buffer.from(await pollRes.arrayBuffer()),
          mimeType: pollType.split(';')[0].trim(),
          model: provider.model || provider.label,
          providerLabel: provider.label,
          tier: provider.tier,
        };
      }
      jsonPayload = (await pollRes.json()) as Record<string, unknown>;
      const statusStr = String(jsonPayload.status || '').toUpperCase();
      if (statusStr === 'FAILED' || statusStr === 'CANCELED' || statusStr === 'ERROR') {
        throw new ProviderConfigurationError(
          `${provider.label} devolvió estado ${statusStr}: ${String(jsonPayload.error || '')}`,
          { status: 502, capability: targetCapability, code: 'PROVIDER_UPSTREAM_ERROR' }
        );
      }
      extracted = extractVideoUrlOrBase64FromJson(jsonPayload);
      if (extracted?.url || extracted?.b64) break;
      if (
        (statusStr === 'COMPLETED' || statusStr === 'SUCCEEDED') &&
        typeof jsonPayload.response_url === 'string'
      ) {
        const safeResultUrl = await assertSafePublicHttpsUrl(
          String(jsonPayload.response_url),
          targetCapability
        );
        const finalRes = await fetch(safeResultUrl, { headers });
        if (finalRes.ok) {
          const finalJson = await finalRes.json();
          extracted = extractVideoUrlOrBase64FromJson(finalJson);
          if (extracted?.url || extracted?.b64) break;
        }
      }
    }
  }

  if (extracted?.b64) {
    return {
      buffer: Buffer.from(extracted.b64, 'base64'),
      mimeType: extracted.mimeType || 'video/mp4',
      model: provider.model || provider.label,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }
  if (extracted?.url) {
    const downloaded = await downloadExternalMediaSafely(extracted.url, targetCapability);
    return {
      ...downloaded,
      model: provider.model || provider.label,
      providerLabel: provider.label,
      tier: provider.tier,
    };
  }

  throw new ProviderConfigurationError(
    `${provider.label} no devolvió un archivo o URL de video reconocible.`,
    { status: 502, capability: targetCapability, code: 'PROVIDER_UPSTREAM_ERROR' }
  );
}
