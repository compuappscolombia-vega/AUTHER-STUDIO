import crypto from 'crypto';
import dns from 'dns/promises';
import fs from 'fs';
import path from 'path';
import type { FrameoMcpToolSummary } from '../types/studio.ts';
import { isPrivateOrReservedIp, validateExternalEndpointUrl } from './apiProviders.ts';

export const DEFAULT_FRAMEO_MCP_URL = 'https://mcp.frameo.ai/mcp';

export interface FrameoOAuthDiscoveryMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported: string[];
}

export interface FrameoMcpSessionPublicStatus {
  connected: boolean;
  mcpUrl: string;
  issuer?: string;
  clientId?: string;
  tokenPreview?: string;
  expiresAt?: string;
  hasRefreshToken: boolean;
  connectedAt?: string;
  serverName?: string;
  tools: FrameoMcpToolSummary[];
  lastToolsSyncAt?: string;
  lastError?: string;
}

interface EncryptedSecretBlob {
  iv: string;
  tag: string;
  cipherText: string;
}

interface StoredFrameoMcpFile {
  mcpUrl: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  clientIdByRedirect?: Record<string, string>;
  clientId?: string;
  encryptedAccessToken?: EncryptedSecretBlob;
  encryptedRefreshToken?: EncryptedSecretBlob;
  tokenPreview?: string;
  expiresAt?: string;
  connectedAt?: string;
  serverName?: string;
  tools: FrameoMcpToolSummary[];
  lastToolsSyncAt?: string;
  lastError?: string;
  updatedAt: string;
}

interface PendingOAuthTransaction {
  state: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  mcpUrl: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  workspaceDir?: string;
  createdAt: number;
}

const pendingTransactions = new Map<string, PendingOAuthTransaction>();
const PENDING_TX_TTL_MS = 10 * 60 * 1000;

function cleanupExpiredTransactions() {
  const now = Date.now();
  for (const [key, tx] of pendingTransactions.entries()) {
    if (now - tx.createdAt > PENDING_TX_TTL_MS) {
      pendingTransactions.delete(key);
    }
  }
}

function getWorkspaceRoot(workspaceDir?: string): string {
  return workspaceDir || path.resolve(process.cwd(), 'workspace');
}

function sanitizeUid(userId: string): string {
  return (userId || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function getFrameoSessionFilePath(userId: string, workspaceDir?: string): string {
  return path.join(
    getWorkspaceRoot(workspaceDir),
    'users',
    sanitizeUid(userId),
    'frameo_mcp_session.json'
  );
}

let cachedKey: Buffer | null = null;

function getEncryptionKey(workspaceDir?: string): Buffer {
  if (cachedKey) return cachedKey;
  const envSecret = (
    process.env.API_VAULT_SECRET ||
    process.env.ADMIN_SESSION_SECRET ||
    ''
  ).trim();
  if (envSecret.length >= 16) {
    cachedKey = crypto.scryptSync(envSecret, 'auteur-studio-vault-v1', 32);
    return cachedKey;
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
  cachedKey = crypto.scryptSync(rawSecret, 'auteur-studio-vault-v1', 32);
  return cachedKey;
}

function encryptToken(plain: string, workspaceDir?: string): EncryptedSecretBlob | undefined {
  const clean = plain.trim();
  if (!clean) return undefined;
  const key = getEncryptionKey(workspaceDir);
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

function decryptToken(blob: EncryptedSecretBlob | undefined, workspaceDir?: string): string {
  if (!blob || !blob.iv || !blob.tag || !blob.cipherText) return '';
  try {
    const key = getEncryptionKey(workspaceDir);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(blob.cipherText, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

function maskToken(raw?: string): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  if (clean.length <= 10) return '••••••••';
  return `${clean.slice(0, 6)}••••${clean.slice(-4)}`;
}

function readFrameoSessionFile(userId: string, workspaceDir?: string): StoredFrameoMcpFile {
  const filePath = getFrameoSessionFilePath(userId, workspaceDir);
  if (!fs.existsSync(filePath)) {
    return {
      mcpUrl: DEFAULT_FRAMEO_MCP_URL,
      tools: [],
      updatedAt: new Date(0).toISOString(),
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StoredFrameoMcpFile;
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        mcpUrl: parsed.mcpUrl || DEFAULT_FRAMEO_MCP_URL,
        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      };
    }
  } catch {
    // Fallback cleanly
  }
  return {
    mcpUrl: DEFAULT_FRAMEO_MCP_URL,
    tools: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function writeFrameoSessionFile(
  userId: string,
  data: StoredFrameoMcpFile,
  workspaceDir?: string
): void {
  const filePath = getFrameoSessionFilePath(userId, workspaceDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export async function assertSafePublicHttpsUrlForMcp(rawUrl: string): Promise<string> {
  const check = validateExternalEndpointUrl(rawUrl);
  if (!check.valid || !check.normalizedUrl) {
    throw new Error(check.error || 'URL MCP externa inválida.');
  }
  const parsed = new URL(check.normalizedUrl);
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records || records.length === 0) {
    throw new Error(`No se pudo resolver el host "${parsed.hostname}".`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Bloqueado por seguridad SSRF: "${parsed.hostname}" resuelve a IP privada.`);
    }
  }
  return check.normalizedUrl;
}

export function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export function parseMcpResponseText(
  rawText: string,
  expectedId?: number | string
): Record<string, unknown> {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    throw new Error('El servidor MCP devolvió una respuesta vacía.');
  }

  // Case 1: Pure JSON-RPC response
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const match =
          expectedId !== undefined
            ? parsed.find((m) => m && typeof m === 'object' && m.id === expectedId)
            : parsed[parsed.length - 1];
        if (match && typeof match === 'object') return match as Record<string, unknown>;
      } else if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Fall through to SSE line parsing
    }
  }

  // Case 2: text/event-stream SSE lines (`data: {...}`)
  const envelopes: Array<Record<string, unknown>> = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const cleanLine = line.trim();
    if (!cleanLine.startsWith('data:')) continue;
    const payload = cleanLine.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') {
        envelopes.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Skip non-JSON SSE chunks
    }
  }

  if (envelopes.length === 0) {
    throw new Error(`Respuesta MCP no reconocida: ${trimmed.slice(0, 220)}`);
  }

  if (expectedId !== undefined) {
    const exact = envelopes.find((env) => env.id === expectedId);
    if (exact) return exact;
  }
  return envelopes[envelopes.length - 1];
}

export function selectFrameoVideoTool(tools: FrameoMcpToolSummary[]): FrameoMcpToolSummary | null {
  if (!Array.isArray(tools) || tools.length === 0) return null;

  let bestTool: FrameoMcpToolSummary | null = null;
  let bestScore = -1;

  for (const tool of tools) {
    const hay = `${tool.name} ${tool.description || ''}`.toLowerCase();
    let score = 0;

    if (/(status|poll|list|get_project|credits|balance|account|whoami|help)/i.test(tool.name)) {
      score -= 10;
    }
    if (/(generate_video|create_video|text_to_video|image_to_video|video_generate|render_video)/i.test(tool.name)) {
      score += 50;
    }
    if (hay.includes('video')) score += 25;
    if (/(veo|kling|seedance|semilla|minimax|happy horse|vfx|manto)/i.test(hay)) score += 15;
    if (/(generate|create|render|produce|make)/i.test(hay)) score += 10;
    if (hay.includes('prompt')) score += 5;

    if (score > bestScore) {
      bestScore = score;
      bestTool = tool;
    }
  }

  return bestScore > 0 ? bestTool : tools[0];
}

export function selectFrameoPollTool(tools: FrameoMcpToolSummary[]): FrameoMcpToolSummary | null {
  return (
    tools.find((t) =>
      /(get_task|task_status|job_status|video_status|check_status|poll|get_generation)/i.test(
        t.name
      )
    ) || null
  );
}

export function buildFrameoToolArguments(
  tool: FrameoMcpToolSummary,
  params: {
    prompt: string;
    model?: string;
    aspectRatio?: string;
    durationSeconds?: number;
    resolution?: '480p' | '1080p';
    vfxMode?: string;
    sourceImageDataUrl?: string;
  }
): Record<string, unknown> {
  const schema = tool.inputSchema as
    | { properties?: Record<string, { type?: string; enum?: unknown[] }>; required?: string[] }
    | undefined;
  const props = schema?.properties;

  if (!props || Object.keys(props).length === 0) {
    return {
      prompt: params.prompt,
      ...(params.model ? { model: params.model } : {}),
      ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
      ...(params.durationSeconds ? { duration: params.durationSeconds } : {}),
      ...(params.sourceImageDataUrl ? { image_url: params.sourceImageDataUrl } : {}),
    };
  }

  const args: Record<string, unknown> = {};
  const keys = Object.keys(props);

  const assignFirstMatch = (candidates: string[], value: unknown) => {
    if (value === undefined || value === '') return;
    for (const key of keys) {
      if (candidates.includes(key.toLowerCase())) {
        const propType = props[key]?.type;
        if ((propType === 'number' || propType === 'integer') && typeof value === 'string') {
          const n = parseFloat(value);
          if (Number.isFinite(n)) args[key] = n;
        } else if (propType === 'string' && typeof value === 'number') {
          args[key] = String(value);
        } else {
          args[key] = value;
        }
        return;
      }
    }
  };

  assignFirstMatch(
    ['prompt', 'text', 'description', 'instruction', 'query', 'input', 'script', 'scene_prompt'],
    params.prompt
  );
  assignFirstMatch(['model', 'model_name', 'model_id', 'engine'], params.model);
  assignFirstMatch(['aspect_ratio', 'aspectratio', 'ratio'], params.aspectRatio);
  assignFirstMatch(
    ['duration', 'duration_sec', 'duration_seconds', 'seconds', 'length'],
    params.durationSeconds
  );
  assignFirstMatch(['resolution', 'quality'], params.resolution);
  assignFirstMatch(['mode', 'vfx_mode', 'task'], params.vfxMode);
  assignFirstMatch(
    ['image_url', 'image', 'first_frame_image', 'start_image', 'reference_image'],
    params.sourceImageDataUrl
  );

  // Ensure any required string prompt field is populated
  if (Array.isArray(schema?.required)) {
    for (const reqKey of schema.required) {
      if (args[reqKey] === undefined) {
        if (/prompt|text|desc|brief|story/i.test(reqKey)) {
          args[reqKey] = params.prompt;
        }
      }
    }
  }

  return args;
}

export function extractVideoOrJobFromMcpResult(result: Record<string, unknown>): {
  videoUrl?: string;
  base64?: string;
  mimeType?: string;
  jobId?: string;
  textSummary: string;
} {
  const texts: string[] = [];
  let foundUrl: string | undefined;
  let foundB64: string | undefined;
  let foundMime: string | undefined;
  let foundJobId: string | undefined;

  const inspectObject = (obj: Record<string, unknown>) => {
    for (const k of ['videoUrl', 'video_url', 'download_url', 'mp4_url', 'output_url', 'url']) {
      const v = obj[k];
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
        foundUrl = foundUrl || v;
      }
    }
    for (const k of ['task_id', 'taskId', 'job_id', 'jobId', 'generation_id', 'id']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim() && !v.startsWith('http')) {
        foundJobId = foundJobId || v.trim();
      }
    }
    if (Array.isArray(obj.videos) && obj.videos[0] && typeof obj.videos[0] === 'object') {
      inspectObject(obj.videos[0] as Record<string, unknown>);
    }
    if (obj.data && typeof obj.data === 'object') {
      inspectObject(obj.data as Record<string, unknown>);
    }
  };

  if (result.structuredContent && typeof result.structuredContent === 'object') {
    inspectObject(result.structuredContent as Record<string, unknown>);
  }

  const contentList = Array.isArray(result.content) ? result.content : [];
  for (const item of contentList) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === 'text' && typeof rec.text === 'string') {
      texts.push(rec.text);
      try {
        const parsed = JSON.parse(rec.text);
        if (parsed && typeof parsed === 'object') {
          inspectObject(parsed as Record<string, unknown>);
        }
      } catch {
        const urlMatch = rec.text.match(/https:\/\/[^\s"'<>)]+/g);
        if (urlMatch) {
          const videoCandidate =
            urlMatch.find((u) => /\.(mp4|webm|mov)(\?|$)/i.test(u)) || urlMatch[0];
          if (videoCandidate) foundUrl = foundUrl || videoCandidate;
        }
      }
    } else if (rec.type === 'resource' && rec.resource && typeof rec.resource === 'object') {
      const r = rec.resource as Record<string, unknown>;
      if (typeof r.uri === 'string' && /^https?:\/\//i.test(r.uri)) {
        foundUrl = foundUrl || r.uri;
      }
      if (typeof r.blob === 'string' && r.blob.trim()) {
        foundB64 = foundB64 || r.blob.trim();
        foundMime = typeof r.mimeType === 'string' ? r.mimeType : 'video/mp4';
      }
    }
  }

  return {
    videoUrl: foundUrl,
    base64: foundB64,
    mimeType: foundMime,
    jobId: foundJobId,
    textSummary: texts.join('\n').trim(),
  };
}

export async function discoverFrameoOAuthMetadata(
  mcpUrlRaw = DEFAULT_FRAMEO_MCP_URL
): Promise<FrameoOAuthDiscoveryMetadata> {
  const safeMcpUrl = await assertSafePublicHttpsUrlForMcp(mcpUrlRaw);
  const parsedMcp = new URL(safeMcpUrl);
  const origin = parsedMcp.origin;

  // Attempt standard OAuth protected resource + authorization server discovery
  let authServerUrl = `${origin}/.well-known/oauth-authorization-server`;
  try {
    const prUrl = await assertSafePublicHttpsUrlForMcp(
      `${origin}/.well-known/oauth-protected-resource${parsedMcp.pathname}`
    );
    const prRes = await fetch(prUrl, { signal: AbortSignal.timeout(7000) });
    if (prRes.ok) {
      const prJson = (await prRes.json()) as { authorization_servers?: string[] };
      if (Array.isArray(prJson.authorization_servers) && prJson.authorization_servers[0]) {
        const asBase = prJson.authorization_servers[0].replace(/\/+$/, '');
        authServerUrl = `${asBase}/.well-known/oauth-authorization-server`;
      }
    }
  } catch {
    // Default well-known path works for mcp.frameo.ai
  }

  const safeAsUrl = await assertSafePublicHttpsUrlForMcp(authServerUrl);
  const asRes = await fetch(safeAsUrl, { signal: AbortSignal.timeout(9000) });
  if (!asRes.ok) {
    throw new Error(`No se pudo consultar el servidor OAuth de Frameo (HTTP ${asRes.status}).`);
  }
  const asJson = (await asRes.json()) as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    registration_endpoint?: string;
    scopes_supported?: string[];
  };

  if (!asJson.authorization_endpoint || !asJson.token_endpoint) {
    throw new Error('Los metadatos OAuth de Frameo.AI no incluyen authorization_endpoint / token_endpoint.');
  }

  await assertSafePublicHttpsUrlForMcp(asJson.authorization_endpoint);
  await assertSafePublicHttpsUrlForMcp(asJson.token_endpoint);
  if (asJson.registration_endpoint) {
    await assertSafePublicHttpsUrlForMcp(asJson.registration_endpoint);
  }

  return {
    issuer: asJson.issuer || origin,
    authorizationEndpoint: asJson.authorization_endpoint,
    tokenEndpoint: asJson.token_endpoint,
    registrationEndpoint: asJson.registration_endpoint,
    scopesSupported:
      Array.isArray(asJson.scopes_supported) && asJson.scopes_supported.length > 0
        ? asJson.scopes_supported
        : ['frameo'],
  };
}

async function ensureDynamicClientId(params: {
  userId: string;
  redirectUri: string;
  metadata: FrameoOAuthDiscoveryMetadata;
  workspaceDir?: string;
}): Promise<string> {
  const session = readFrameoSessionFile(params.userId, params.workspaceDir);
  const cached = session.clientIdByRedirect?.[params.redirectUri];
  if (cached) return cached;

  if (!params.metadata.registrationEndpoint) {
    throw new Error('El servidor Frameo OAuth no expone registro dinámico de cliente.');
  }

  const safeRegUrl = await assertSafePublicHttpsUrlForMcp(params.metadata.registrationEndpoint);
  const regRes = await fetch(safeRegUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'AUTEUR Studio (Admin Frameo MCP)',
      redirect_uris: [params.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: params.metadata.scopesSupported.join(' '),
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!regRes.ok) {
    const errText = await regRes.text().catch(() => '');
    throw new Error(
      `No se pudo registrar AUTEUR Studio como cliente OAuth en Frameo (HTTP ${regRes.status}): ${errText.slice(0, 180)}`
    );
  }

  const regJson = (await regRes.json()) as { client_id?: string };
  if (!regJson.client_id) {
    throw new Error('Frameo OAuth /register no devolvió client_id.');
  }

  const nextMap = {
    ...(session.clientIdByRedirect || {}),
    [params.redirectUri]: regJson.client_id,
  };
  writeFrameoSessionFile(
    params.userId,
    {
      ...session,
      clientId: regJson.client_id,
      clientIdByRedirect: nextMap,
      issuer: params.metadata.issuer,
      authorizationEndpoint: params.metadata.authorizationEndpoint,
      tokenEndpoint: params.metadata.tokenEndpoint,
      registrationEndpoint: params.metadata.registrationEndpoint,
      updatedAt: new Date().toISOString(),
    },
    params.workspaceDir
  );

  return regJson.client_id;
}

export async function createFrameoOAuthAuthorizationUrl(params: {
  userId: string;
  redirectUri: string;
  mcpUrl?: string;
  workspaceDir?: string;
}): Promise<{
  authUrl: string;
  state: string;
  clientId: string;
  redirectUri: string;
  mcpUrl: string;
}> {
  cleanupExpiredTransactions();
  const mcpUrl = await assertSafePublicHttpsUrlForMcp(params.mcpUrl || DEFAULT_FRAMEO_MCP_URL);
  const metadata = await discoverFrameoOAuthMetadata(mcpUrl);
  const clientId = await ensureDynamicClientId({
    userId: params.userId,
    redirectUri: params.redirectUri,
    metadata,
    workspaceDir: params.workspaceDir,
  });

  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = crypto.randomBytes(24).toString('base64url');

  pendingTransactions.set(state, {
    state,
    userId: params.userId,
    codeVerifier,
    redirectUri: params.redirectUri,
    clientId,
    mcpUrl,
    issuer: metadata.issuer,
    authorizationEndpoint: metadata.authorizationEndpoint,
    tokenEndpoint: metadata.tokenEndpoint,
    registrationEndpoint: metadata.registrationEndpoint,
    workspaceDir: params.workspaceDir,
    createdAt: Date.now(),
  });

  const authUrlObj = new URL(metadata.authorizationEndpoint);
  authUrlObj.searchParams.set('response_type', 'code');
  authUrlObj.searchParams.set('client_id', clientId);
  authUrlObj.searchParams.set('redirect_uri', params.redirectUri);
  authUrlObj.searchParams.set('scope', metadata.scopesSupported.join(' '));
  authUrlObj.searchParams.set('state', state);
  authUrlObj.searchParams.set('code_challenge', codeChallenge);
  authUrlObj.searchParams.set('code_challenge_method', 'S256');
  authUrlObj.searchParams.set('resource', mcpUrl);

  return {
    authUrl: authUrlObj.toString(),
    state,
    clientId,
    redirectUri: params.redirectUri,
    mcpUrl,
  };
}

export async function completeFrameoOAuthCallback(params: {
  code: string;
  state: string;
}): Promise<{
  userId: string;
  mcpUrl: string;
  accessToken: string;
  tools: FrameoMcpToolSummary[];
  serverName?: string;
}> {
  cleanupExpiredTransactions();
  const tx = pendingTransactions.get(params.state);
  if (!tx) {
    throw new Error('Estado OAuth expirado o inválido. Inicia de nuevo la conexión con Frameo.AI.');
  }
  pendingTransactions.delete(params.state);

  const safeTokenEndpoint = await assertSafePublicHttpsUrlForMcp(tx.tokenEndpoint);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: tx.redirectUri,
    client_id: tx.clientId,
    code_verifier: tx.codeVerifier,
  });

  const tokenRes = await fetch(safeTokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    signal: AbortSignal.timeout(12000),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new Error(
      `Frameo.AI rechazó el intercambio de token OAuth (HTTP ${tokenRes.status}): ${errText.slice(0, 200)}`
    );
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokenJson.access_token) {
    throw new Error('Frameo.AI no devolvió access_token en el intercambio OAuth.');
  }

  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + Number(tokenJson.expires_in) * 1000).toISOString()
    : undefined;

  const existing = readFrameoSessionFile(tx.userId, tx.workspaceDir);
  const nextSession: StoredFrameoMcpFile = {
    ...existing,
    mcpUrl: tx.mcpUrl,
    issuer: tx.issuer,
    authorizationEndpoint: tx.authorizationEndpoint,
    tokenEndpoint: tx.tokenEndpoint,
    registrationEndpoint: tx.registrationEndpoint,
    clientId: tx.clientId,
    encryptedAccessToken: encryptToken(tokenJson.access_token, tx.workspaceDir),
    encryptedRefreshToken: tokenJson.refresh_token
      ? encryptToken(tokenJson.refresh_token, tx.workspaceDir)
      : existing.encryptedRefreshToken,
    tokenPreview: maskToken(tokenJson.access_token),
    expiresAt,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  };
  writeFrameoSessionFile(tx.userId, nextSession, tx.workspaceDir);

  let tools: FrameoMcpToolSummary[] = [];
  let serverName: string | undefined;
  try {
    const syncResult = await listFrameoMcpTools(tx.userId, tx.workspaceDir, tokenJson.access_token);
    tools = syncResult.tools;
    serverName = syncResult.serverName;
  } catch (err) {
    const updated = readFrameoSessionFile(tx.userId, tx.workspaceDir);
    writeFrameoSessionFile(
      tx.userId,
      {
        ...updated,
        lastError: err instanceof Error ? err.message : 'Handshake MCP pendiente',
        updatedAt: new Date().toISOString(),
      },
      tx.workspaceDir
    );
  }

  return {
    userId: tx.userId,
    mcpUrl: tx.mcpUrl,
    accessToken: tokenJson.access_token,
    tools,
    serverName,
  };
}

export async function getValidFrameoMcpAccessToken(
  userId: string,
  workspaceDir?: string,
  explicitBearerToken?: string
): Promise<{ accessToken: string; mcpUrl: string } | null> {
  const session = readFrameoSessionFile(userId, workspaceDir);
  const mcpUrl = session.mcpUrl || DEFAULT_FRAMEO_MCP_URL;

  if (explicitBearerToken && explicitBearerToken.trim()) {
    return { accessToken: explicitBearerToken.trim(), mcpUrl };
  }

  const accessToken = decryptToken(session.encryptedAccessToken, workspaceDir);
  const refreshToken = decryptToken(session.encryptedRefreshToken, workspaceDir);

  if (!accessToken && !refreshToken) return null;

  const isExpired =
    session.expiresAt &&
    Number.isFinite(Date.parse(session.expiresAt)) &&
    Date.parse(session.expiresAt) - 60_000 < Date.now();

  if (accessToken && !isExpired) {
    return { accessToken, mcpUrl };
  }

  if (refreshToken && session.tokenEndpoint && session.clientId) {
    try {
      const safeTokenUrl = await assertSafePublicHttpsUrlForMcp(session.tokenEndpoint);
      const res = await fetch(safeTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: session.clientId,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (json.access_token) {
          const updated: StoredFrameoMcpFile = {
            ...session,
            encryptedAccessToken: encryptToken(json.access_token, workspaceDir),
            encryptedRefreshToken: json.refresh_token
              ? encryptToken(json.refresh_token, workspaceDir)
              : session.encryptedRefreshToken,
            tokenPreview: maskToken(json.access_token),
            expiresAt: json.expires_in
              ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
              : session.expiresAt,
            lastError: undefined,
            updatedAt: new Date().toISOString(),
          };
          writeFrameoSessionFile(userId, updated, workspaceDir);
          return { accessToken: json.access_token, mcpUrl };
        }
      }
    } catch {
      // Fall through if refresh fails
    }
  }

  return accessToken ? { accessToken, mcpUrl } : null;
}

async function sendMcpJsonRpc(params: {
  mcpUrl: string;
  accessToken: string;
  sessionId?: string;
  id?: number;
  method: string;
  rpcParams?: Record<string, unknown>;
  isNotification?: boolean;
}): Promise<{ envelope: Record<string, unknown> | null; sessionId?: string }> {
  const safeMcpUrl = await assertSafePublicHttpsUrlForMcp(params.mcpUrl);
  const payload = params.isNotification
    ? { jsonrpc: '2.0', method: params.method, params: params.rpcParams || {} }
    : { jsonrpc: '2.0', id: params.id ?? 1, method: params.method, params: params.rpcParams || {} };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${params.accessToken}`,
    'MCP-Protocol-Version': '2025-03-26',
  };
  if (params.sessionId) {
    headers['Mcp-Session-Id'] = params.sessionId;
  }

  const res = await fetch(safeMcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });

  const nextSessionId = res.headers.get('mcp-session-id') || params.sessionId;

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Frameo.AI MCP respondió HTTP ${res.status}${res.status === 401 ? ' (sesión OAuth expirada o no autorizada)' : ''}: ${errText.slice(0, 220)}`
    );
  }

  if (params.isNotification || res.status === 202 || res.status === 204) {
    return { envelope: null, sessionId: nextSessionId };
  }

  const rawText = await res.text();
  if (!rawText.trim()) {
    return { envelope: null, sessionId: nextSessionId };
  }

  const envelope = parseMcpResponseText(rawText, params.id);
  if (envelope.error && typeof envelope.error === 'object') {
    const errObj = envelope.error as { message?: string; code?: number };
    throw new Error(errObj.message || `Error MCP (${errObj.code ?? 'desconocido'})`);
  }

  return { envelope, sessionId: nextSessionId };
}

async function openInitializedMcpSession(mcpUrl: string, accessToken: string): Promise<{
  sessionId?: string;
  serverName?: string;
}> {
  const initRes = await sendMcpJsonRpc({
    mcpUrl,
    accessToken,
    id: 1,
    method: 'initialize',
    rpcParams: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'auteur-studio', version: '1.0.0' },
    },
  });

  const initResult = (initRes.envelope?.result as Record<string, unknown> | undefined) || {};
  const serverInfo = initResult.serverInfo as { name?: string; version?: string } | undefined;
  const serverName = serverInfo?.name
    ? `${serverInfo.name}${serverInfo.version ? ` v${serverInfo.version}` : ''}`
    : 'Frameo.AI MCP';

  try {
    await sendMcpJsonRpc({
      mcpUrl,
      accessToken,
      sessionId: initRes.sessionId,
      method: 'notifications/initialized',
      isNotification: true,
    });
  } catch {
    // Non-fatal on stateless streamable servers
  }

  return { sessionId: initRes.sessionId, serverName };
}

export async function listFrameoMcpTools(
  userId: string,
  workspaceDir?: string,
  explicitBearerToken?: string
): Promise<{
  tools: FrameoMcpToolSummary[];
  serverName?: string;
  sessionId?: string;
}> {
  const tokenCtx = await getValidFrameoMcpAccessToken(userId, workspaceDir, explicitBearerToken);
  if (!tokenCtx) {
    throw new Error(
      'Frameo.AI MCP no está autenticado. Pulsa "Conectar con Frameo.AI (OAuth MCP)" para iniciar sesión.'
    );
  }

  const { sessionId, serverName } = await openInitializedMcpSession(
    tokenCtx.mcpUrl,
    tokenCtx.accessToken
  );
  const toolsRes = await sendMcpJsonRpc({
    mcpUrl: tokenCtx.mcpUrl,
    accessToken: tokenCtx.accessToken,
    sessionId,
    id: 2,
    method: 'tools/list',
    rpcParams: {},
  });

  const resultObj = (toolsRes.envelope?.result as Record<string, unknown> | undefined) || {};
  const rawTools = Array.isArray(resultObj.tools) ? resultObj.tools : [];
  const tools: FrameoMcpToolSummary[] = rawTools
    .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object' && t.name))
    .map((t) => ({
      name: String(t.name),
      description: typeof t.description === 'string' ? t.description : '',
      inputSchema:
        t.inputSchema && typeof t.inputSchema === 'object'
          ? (t.inputSchema as Record<string, unknown>)
          : undefined,
    }));

  const current = readFrameoSessionFile(userId, workspaceDir);
  writeFrameoSessionFile(
    userId,
    {
      ...current,
      mcpUrl: tokenCtx.mcpUrl,
      serverName,
      tools,
      lastToolsSyncAt: new Date().toISOString(),
      lastError: undefined,
      updatedAt: new Date().toISOString(),
    },
    workspaceDir
  );

  return { tools, serverName, sessionId };
}

export async function callFrameoMcpTool(
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  workspaceDir?: string,
  explicitBearerToken?: string
): Promise<Record<string, unknown>> {
  const tokenCtx = await getValidFrameoMcpAccessToken(userId, workspaceDir, explicitBearerToken);
  if (!tokenCtx) {
    throw new Error('Frameo.AI MCP no está autenticado. Conecta tu cuenta Frameo.AI primero.');
  }

  const { sessionId } = await openInitializedMcpSession(tokenCtx.mcpUrl, tokenCtx.accessToken);
  const callRes = await sendMcpJsonRpc({
    mcpUrl: tokenCtx.mcpUrl,
    accessToken: tokenCtx.accessToken,
    sessionId,
    id: 3,
    method: 'tools/call',
    rpcParams: {
      name: toolName,
      arguments: args,
    },
  });

  const result = (callRes.envelope?.result as Record<string, unknown> | undefined) || {};
  if (result.isError === true) {
    const extracted = extractVideoOrJobFromMcpResult(result);
    throw new Error(extracted.textSummary || `La herramienta Frameo MCP "${toolName}" reportó un error.`);
  }
  return result;
}

export function getFrameoMcpPublicStatus(
  userId: string,
  workspaceDir?: string
): FrameoMcpSessionPublicStatus {
  const session = readFrameoSessionFile(userId, workspaceDir);
  const hasAccess = Boolean(decryptToken(session.encryptedAccessToken, workspaceDir));
  const hasRefresh = Boolean(decryptToken(session.encryptedRefreshToken, workspaceDir));
  return {
    connected: hasAccess || hasRefresh,
    mcpUrl: session.mcpUrl || DEFAULT_FRAMEO_MCP_URL,
    issuer: session.issuer,
    clientId: session.clientId,
    tokenPreview: session.tokenPreview,
    expiresAt: session.expiresAt,
    hasRefreshToken: hasRefresh,
    connectedAt: session.connectedAt,
    serverName: session.serverName,
    tools: session.tools || [],
    lastToolsSyncAt: session.lastToolsSyncAt,
    lastError: session.lastError,
  };
}

export function disconnectFrameoMcpSession(userId: string, workspaceDir?: string): void {
  const filePath = getFrameoSessionFilePath(userId, workspaceDir);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export async function executeFrameoMcpVideo(params: {
  userId: string;
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  model?: string;
  vfxMode?: string;
  resolution?: '480p' | '1080p';
  sourceImageDataUrl?: string;
  explicitBearerToken?: string;
  workspaceDir?: string;
}): Promise<{
  videoUrl?: string;
  base64?: string;
  mimeType?: string;
  toolUsed: string;
  textSummary: string;
}> {
  const session = readFrameoSessionFile(params.userId, params.workspaceDir);
  let tools = session.tools || [];
  if (tools.length === 0) {
    const synced = await listFrameoMcpTools(
      params.userId,
      params.workspaceDir,
      params.explicitBearerToken
    );
    tools = synced.tools;
  }

  const videoTool = selectFrameoVideoTool(tools);
  if (!videoTool) {
    throw new Error(
      'El servidor Frameo.AI MCP no expuso ninguna herramienta compatible de generación de video.'
    );
  }

  const toolArgs = buildFrameoToolArguments(videoTool, {
    prompt: params.prompt,
    model: params.model,
    aspectRatio: params.aspectRatio,
    durationSeconds: params.durationSeconds,
    resolution: params.resolution,
    vfxMode: params.vfxMode,
    sourceImageDataUrl: params.sourceImageDataUrl,
  });

  let callResult = await callFrameoMcpTool(
    params.userId,
    videoTool.name,
    toolArgs,
    params.workspaceDir,
    params.explicitBearerToken
  );
  let extracted = extractVideoOrJobFromMcpResult(callResult);

  // If MCP returns an async job/task ID and exposes a status tool, poll gracefully
  if (!extracted.videoUrl && !extracted.base64 && extracted.jobId) {
    const pendingJobId = extracted.jobId;
    const pollTool = selectFrameoPollTool(tools);
    if (pollTool) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollArgs = buildFrameoToolArguments(pollTool, {
          prompt: pendingJobId,
        });
        if (Object.keys(pollArgs).length === 0) {
          pollArgs.task_id = pendingJobId;
          pollArgs.id = pendingJobId;
        }
        callResult = await callFrameoMcpTool(
          params.userId,
          pollTool.name,
          pollArgs,
          params.workspaceDir,
          params.explicitBearerToken
        );
        extracted = extractVideoOrJobFromMcpResult(callResult);
        if (extracted.videoUrl || extracted.base64) break;
        if (/\b(failed|error|canceled|rejected)\b/i.test(extracted.textSummary)) {
          throw new Error(`Frameo.AI reportó fallo en tarea ${pendingJobId}: ${extracted.textSummary}`);
        }
      }
    }
  }

  if (!extracted.videoUrl && !extracted.base64) {
    throw new Error(
      extracted.textSummary ||
        `Frameo.AI MCP (${videoTool.name}) no devolvió un video MP4 descargable.`
    );
  }

  return {
    videoUrl: extracted.videoUrl,
    base64: extracted.base64,
    mimeType: extracted.mimeType,
    toolUsed: videoTool.name,
    textSummary: extracted.textSummary,
  };
}
