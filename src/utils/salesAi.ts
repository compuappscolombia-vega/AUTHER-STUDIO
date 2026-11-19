import { GoogleGenAI } from '@google/genai';

export async function generateSalesDraft(params: {
  apiKey?: string;
  leadName: string;
  companyName: string;
  needSummary: string;
  serviceName: string;
  evidence: string;
}) {
  if (!params.apiKey) throw new Error('GEMINI_API_KEY no está configurada');
  const ai = new GoogleGenAI({ apiKey: params.apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Redacta un correo comercial corto y profesional en español para ${params.contactName || params.leadName} de ${params.companyName}. Necesidad: ${params.needSummary}. Servicio: ${params.serviceName}. Evidencia verificable: ${params.evidence}. No inventes datos, no cites precio ni garantías. Firma como Diego Monroy, CEO de CompuApps SecureDev, 3165382561, Cali Colombia.`,
  });
  return (response.text || '').trim();
}
