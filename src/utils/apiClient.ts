export async function parseApiResponse<T = Record<string, unknown>>(
  res: Response,
  fallbackError: string
): Promise<T> {
  const rawText = await res.text();
  let parsed: unknown = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleanSnippet = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!res.ok) {
        if (res.status === 504 || res.status === 502) {
          throw new Error(
            'El servidor tardó demasiado en responder (timeout de red). Reintenta o usa generación asíncrona.'
          );
        }
        if (res.status === 413) {
          throw new Error('El archivo enviado supera el límite permitido por el servidor (24 MB).');
        }
        throw new Error(
          cleanSnippet
            ? `${fallbackError} (${res.status}): ${cleanSnippet.slice(0, 140)}`
            : `${fallbackError} (HTTP ${res.status})`
        );
      }
      throw new Error('La respuesta del servidor no tuvo un formato JSON válido.');
    }
  }

  if (!res.ok) {
    const errObj = (parsed || {}) as { error?: string; message?: string };
    throw new Error(errObj.error || errObj.message || `${fallbackError} (HTTP ${res.status})`);
  }

  return (parsed ?? {}) as T;
}
