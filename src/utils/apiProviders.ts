import type {
  ApiBillingTier,
  ApiCapability,
  ApiProviderInput,
  ApiProviderKind,
} from '../types/studio.ts';

export interface ProviderPresetOption {
  id: ApiProviderKind | 'auto';
  label: string;
  tierLabel: 'Free' | 'Pago' | 'Free / Pago';
  requiresKey: boolean;
  defaultEndpointUrl: string;
  defaultModel: string;
  placeholderUrl: string;
  description: string;
}

export const IMAGE_PROVIDER_PRESETS: ProviderPresetOption[] = [
  {
    id: 'auto',
    label: 'Auto-detectar por URL o clave',
    tierLabel: 'Free / Pago',
    requiresKey: false,
    defaultEndpointUrl: '',
    defaultModel: '',
    placeholderUrl: 'Pega cualquier endpoint HTTPS o solo tu API key...',
    description: 'Reconoce automáticamente Gemini, HuggingFace, OpenAI, Fal, Replicate, Pollinations o REST.',
  },
  {
    id: 'pollinations',
    label: 'Pollinations Image (Sin clave / Free)',
    tierLabel: 'Free',
    requiresKey: false,
    defaultEndpointUrl: 'https://image.pollinations.ai/prompt',
    defaultModel: 'flux',
    placeholderUrl: 'https://image.pollinations.ai/prompt',
    description: 'Generación de imágenes gratuita sin clave obligatoria (ideal para pruebas y borradores).',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Inference (Free / Pro)',
    tierLabel: 'Free / Pago',
    requiresKey: true,
    defaultEndpointUrl:
      'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    placeholderUrl: 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    description: 'Soporta tokens gratuitos y Pro con modelos FLUX / SDXL.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini Image (Free o Pago)',
    tierLabel: 'Free / Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.1-flash-lite-image',
    placeholderUrl: 'https://generativelanguage.googleapis.com',
    description: 'Detecta automáticamente si la clave permite 4K (Nano Banana 2.1) o Flash Lite Image.',
  },
  {
    id: 'openai',
    label: 'OpenAI / Compatible (/v1/images/generations)',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://api.openai.com/v1/images/generations',
    defaultModel: 'gpt-image-1',
    placeholderUrl: 'https://api.openai.com/v1/images/generations',
    description: 'Compatible con OpenAI Images y endpoints compatibles (Together, Fireworks, etc.).',
  },
  {
    id: 'fal',
    label: 'Fal.ai (Flux / Fast SD)',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://fal.run/fal-ai/flux/schnell',
    defaultModel: 'fal-ai/flux/schnell',
    placeholderUrl: 'https://fal.run/fal-ai/flux/schnell',
    description: 'Inferencia rápida por endpoint directo o cola queue.fal.run.',
  },
  {
    id: 'replicate',
    label: 'Replicate Predictions',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
    defaultModel: 'black-forest-labs/flux-schnell',
    placeholderUrl: 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
    description: 'Crea predicciones en Replicate y espera el render automáticamente.',
  },
  {
    id: 'custom_rest',
    label: 'REST Personalizado (Free o Pago)',
    tierLabel: 'Free / Pago',
    requiresKey: false,
    defaultEndpointUrl: '',
    defaultModel: '',
    placeholderUrl: 'https://tu-api.ejemplo.com/v1/generate-image',
    description: 'Cualquier API HTTPS externa que devuelva imagen binaria o JSON (url / base64).',
  },
];

export const VIDEO_PROVIDER_PRESETS: ProviderPresetOption[] = [
  {
    id: 'auto',
    label: 'Auto-detectar por URL o clave',
    tierLabel: 'Free / Pago',
    requiresKey: false,
    defaultEndpointUrl: '',
    defaultModel: '',
    placeholderUrl: 'Pega cualquier endpoint HTTPS de video o tu API key...',
    description: 'Reconoce automáticamente HuggingFace, Replicate, Fal.ai, Gemini Omni, OpenAI o REST.',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Video Inference (Free / Pro)',
    tierLabel: 'Free / Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://router.huggingface.co/hf-inference/models/Wan-AI/Wan2.1-T2V-14B',
    defaultModel: 'Wan-AI/Wan2.1-T2V-14B',
    placeholderUrl: 'https://router.huggingface.co/hf-inference/models/Wan-AI/Wan2.1-T2V-14B',
    description: 'Generación Texto→Video mediante Hugging Face Inference API (free o Pro).',
  },
  {
    id: 'replicate',
    label: 'Replicate Video (Luma / Kling / Wan / Minimax)',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://api.replicate.com/v1/models/wavespeedai/wan-2.1-t2v-480p/predictions',
    defaultModel: 'wavespeedai/wan-2.1-t2v-480p',
    placeholderUrl: 'https://api.replicate.com/v1/models/wavespeedai/wan-2.1-t2v-480p/predictions',
    description: 'Soporta Texto→Video e Imagen→Video con sondeo automático de trabajos.',
  },
  {
    id: 'fal',
    label: 'Fal.ai Video (Kling / Luma / Wan / Minimax)',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://queue.fal.run/fal-ai/wan-t2v',
    defaultModel: 'fal-ai/wan-t2v',
    placeholderUrl: 'https://queue.fal.run/fal-ai/wan-t2v',
    description: 'Cola de renderizado Fal.ai con soporte para animación de fotogramas.',
  },
  {
    id: 'gemini',
    label: 'Google Gemini Omni Flash (Solo Pago)',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-omni-1.2-flash',
    placeholderUrl: 'https://generativelanguage.googleapis.com',
    description: 'Requiere clave de Google Cloud con facturación habilitada para Interactions API.',
  },
  {
    id: 'openai',
    label: 'OpenAI / Compatible Video API',
    tierLabel: 'Pago',
    requiresKey: true,
    defaultEndpointUrl: 'https://api.openai.com/v1/videos',
    defaultModel: 'sora-2',
    placeholderUrl: 'https://api.openai.com/v1/videos',
    description: 'Compatible con endpoints de video tipo OpenAI o pasarelas compatibles.',
  },
  {
    id: 'custom_rest',
    label: 'REST Personalizado (Free o Pago)',
    tierLabel: 'Free / Pago',
    requiresKey: false,
    defaultEndpointUrl: '',
    defaultModel: '',
    placeholderUrl: 'https://tu-api.ejemplo.com/v1/generate-video',
    description: 'Cualquier API HTTPS externa que devuelva MP4/WebM binario, URL o base64.',
  },
];

export function isPrivateOrReservedIp(ipOrHost: string): boolean {
  const host = ipOrHost.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    return true;
  }

  // IPv6 loopback, link-local, unique-local, IPv4-mapped
  if (
    host === '::' ||
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('::ffff:')
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((n) => Number(n));
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  // Reject integer / hex encoded IP tricks
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    return true;
  }

  return false;
}

export function validateExternalEndpointUrl(rawUrl: string): {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Indica una URL HTTPS válida para el endpoint.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'La URL del endpoint no tiene un formato válido.' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Por seguridad, solo se permiten endpoints externos con protocolo HTTPS.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'La URL no debe incluir credenciales embebidas.',
    };
  }

  if (isPrivateOrReservedIp(parsed.hostname)) {
    return {
      valid: false,
      error: 'No se permiten direcciones locales, privadas o reservadas en endpoints externos.',
    };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

export function maskApiKey(rawKey?: string): string {
  const clean = (rawKey || '').trim();
  if (!clean) return 'Sin clave (acceso libre)';
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export interface DetectedProviderSpec {
  capability: ApiCapability;
  providerKind: ApiProviderKind;
  label: string;
  tier: 'free' | 'paid' | 'unknown';
  endpointUrl: string;
  model: string;
  authHeader: string;
  authPrefix: string;
  supportsImageToVideo: boolean;
}

export function detectApiProviderSpec(input: ApiProviderInput): DetectedProviderSpec {
  const capability = input.capability;
  const rawKey = (input.apiKey || '').trim();
  const rawUrl = (input.endpointUrl || '').trim();
  const lowerUrl = rawUrl.toLowerCase();
  const explicitHint =
    input.providerHint && input.providerHint !== 'auto' ? input.providerHint : undefined;

  let providerKind: ApiProviderKind = 'custom_rest';

  if (explicitHint) {
    providerKind = explicitHint;
  } else if (lowerUrl.includes('pollinations.ai')) {
    providerKind = 'pollinations';
  } else if (lowerUrl.includes('generativelanguage.googleapis.com') || /^AIza[0-9A-Za-z_-]{10,}/.test(rawKey)) {
    providerKind = 'gemini';
  } else if (lowerUrl.includes('huggingface.co') || rawKey.startsWith('hf_')) {
    providerKind = 'huggingface';
  } else if (lowerUrl.includes('replicate.com') || rawKey.startsWith('r8_')) {
    providerKind = 'replicate';
  } else if (lowerUrl.includes('fal.run') || rawKey.startsWith('fal_') || /^Key\s+/i.test(rawKey)) {
    providerKind = 'fal';
  } else if (lowerUrl.includes('openai.com') || /^sk-(proj-)?[A-Za-z0-9_-]{12,}/.test(rawKey)) {
    providerKind = 'openai';
  } else if (!rawUrl && !rawKey && capability === 'image') {
    providerKind = 'pollinations';
  } else {
    providerKind = 'custom_rest';
  }

  const tierFromHint =
    input.tierHint === 'free' || input.tierHint === 'paid' ? input.tierHint : undefined;

  if (providerKind === 'pollinations') {
    return {
      capability,
      providerKind: 'pollinations',
      label: input.label?.trim() || 'Pollinations Free API',
      tier: tierFromHint || 'free',
      endpointUrl: rawUrl || 'https://image.pollinations.ai/prompt',
      model: (input.model || '').trim() || 'flux',
      authHeader: input.authHeader?.trim() || 'Authorization',
      authPrefix: input.authPrefix ?? 'Bearer ',
      supportsImageToVideo: false,
    };
  }

  if (providerKind === 'gemini') {
    const defaultModel =
      capability === 'video'
        ? 'gemini-omni-1.2-flash'
        : capability === 'image'
          ? tierFromHint === 'paid'
            ? 'gemini-nano-banana-2.1'
            : 'gemini-3.1-flash-lite-image'
          : 'gemini-4-hydrogen';
    return {
      capability,
      providerKind: 'gemini',
      label:
        input.label?.trim() ||
        (capability === 'video'
          ? 'Google Gemini Video (Omni Flash)'
          : capability === 'image'
            ? 'Google Gemini Image'
            : 'Google Gemini Director'),
      tier: tierFromHint || (capability === 'video' ? 'paid' : 'unknown'),
      endpointUrl: rawUrl || 'https://generativelanguage.googleapis.com',
      model: (input.model || '').trim() || defaultModel,
      authHeader: 'x-goog-api-key',
      authPrefix: '',
      supportsImageToVideo: capability === 'video',
    };
  }

  if (providerKind === 'huggingface') {
    const defaultModel =
      capability === 'video' ? 'Wan-AI/Wan2.1-T2V-14B' : 'black-forest-labs/FLUX.1-schnell';
    const chosenModel = (input.model || '').trim() || defaultModel;
    return {
      capability,
      providerKind: 'huggingface',
      label: input.label?.trim() || 'Hugging Face Inference',
      tier: tierFromHint || 'free',
      endpointUrl:
        rawUrl || `https://router.huggingface.co/hf-inference/models/${chosenModel}`,
      model: chosenModel,
      authHeader: input.authHeader?.trim() || 'Authorization',
      authPrefix: input.authPrefix ?? 'Bearer ',
      supportsImageToVideo: false,
    };
  }

  if (providerKind === 'replicate') {
    const defaultModel =
      capability === 'video'
        ? 'wavespeedai/wan-2.1-t2v-480p'
        : 'black-forest-labs/flux-schnell';
    const chosenModel = (input.model || '').trim() || defaultModel;
    return {
      capability,
      providerKind: 'replicate',
      label: input.label?.trim() || 'Replicate API',
      tier: tierFromHint || 'paid',
      endpointUrl:
        rawUrl || `https://api.replicate.com/v1/models/${chosenModel}/predictions`,
      model: chosenModel,
      authHeader: input.authHeader?.trim() || 'Authorization',
      authPrefix: input.authPrefix ?? 'Bearer ',
      supportsImageToVideo: capability === 'video',
    };
  }

  if (providerKind === 'fal') {
    const defaultModel = capability === 'video' ? 'fal-ai/wan-t2v' : 'fal-ai/flux/schnell';
    const chosenModel = (input.model || '').trim() || defaultModel;
    return {
      capability,
      providerKind: 'fal',
      label: input.label?.trim() || 'Fal.ai API',
      tier: tierFromHint || 'paid',
      endpointUrl:
        rawUrl ||
        (capability === 'video'
          ? `https://queue.fal.run/${chosenModel}`
          : `https://fal.run/${chosenModel}`),
      model: chosenModel,
      authHeader: input.authHeader?.trim() || 'Authorization',
      authPrefix: input.authPrefix ?? 'Key ',
      supportsImageToVideo: capability === 'video',
    };
  }

  if (providerKind === 'openai') {
    const defaultModel =
      capability === 'video' ? 'sora-2' : capability === 'image' ? 'gpt-image-1' : 'gpt-4.1';
    const defaultUrl =
      capability === 'video'
        ? 'https://api.openai.com/v1/videos'
        : capability === 'image'
          ? 'https://api.openai.com/v1/images/generations'
          : 'https://api.openai.com/v1/chat/completions';
    return {
      capability,
      providerKind: 'openai',
      label: input.label?.trim() || 'OpenAI / Compatible API',
      tier: tierFromHint || 'paid',
      endpointUrl: rawUrl || defaultUrl,
      model: (input.model || '').trim() || defaultModel,
      authHeader: input.authHeader?.trim() || 'Authorization',
      authPrefix: input.authPrefix ?? 'Bearer ',
      supportsImageToVideo: capability === 'video',
    };
  }

  const inferredTier: 'free' | 'paid' | 'unknown' =
    tierFromHint || (!rawKey ? 'free' : 'unknown');

  return {
    capability,
    providerKind: 'custom_rest',
    label: input.label?.trim() || 'API REST Personalizada',
    tier: inferredTier,
    endpointUrl: rawUrl,
    model: (input.model || '').trim() || 'default',
    authHeader: input.authHeader?.trim() || 'Authorization',
    authPrefix: input.authPrefix ?? 'Bearer ',
    supportsImageToVideo: capability === 'video',
  };
}
