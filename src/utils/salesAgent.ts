import type { SalesLead, SalesServiceId } from '../types/salesAgent';

export function qualifyLead(text: string): SalesServiceId | null {
  const value = text.toLowerCase();
  if (/onlyfans|creador|creator|suscriptor|fideliz/.test(value)) return 'aura-agent';
  if (/pos|inventario|factur|prestamo|préstamo|ventas|punto de venta/.test(value)) return 'control-ventory';
  if (/marca|publicidad|flyer|logo|video|imagen|contenido/.test(value)) return 'commercial-media';
  if (/camara|cámara|seguridad|vigilancia|cctv/.test(value)) return 'vega-cam';
  if (/app|aplicaci|web|móvil|movil|sitio/.test(value)) return 'web-mobile';
  if (/pentest|penetracion|penetración|vulnerabil|seguridad informatica|auditoria/.test(value)) return 'pentesting';
  if (/automat|workflow|robot|procesos/.test(value)) return 'automation';
  if (/tv|radio|prestamo|préstamo/.test(value)) return 'software-rental';
  if (/curso|capacita|formaci|academ/.test(value)) return 'courses';
  if (/soporte|repar|pc|consola|hardware|software/.test(value)) return 'remote-support';
  return null;
}

export function buildLeadSubject(lead: SalesLead): string {
  const service = lead.recommendedService || 'oportunidad';
  return `Oportunidad para optimizar ${lead.needSummary || service}`;
}

export function buildLeadEmail(lead: SalesLead): string {
  const serviceName: Record<string, string> = {
    'aura-agent': 'AuraAgent',
    'control-ventory': 'Control Ventory',
    'commercial-media': 'creación de contenido comercial',
    'vega-cam': 'Vega Cam',
    'web-mobile': 'desarrollo web y móvil',
    pentesting: 'pentesting autorizado',
    automation: 'automatizaciones',
    'software-rental': 'alquiler de software',
    courses: 'cursos virtuales',
    'remote-support': 'soporte técnico avanzado',
  };
  const service = serviceName[lead.recommendedService || ''] || 'una solución adaptada';
  const evidence = lead.evidenceUrls[0] ? `Vi que ${lead.needSummary || 'están presentes en el sector'}.` : 'Noté una oportunidad para mejorar una necesidad operativa.';

  return `Hola ${lead.contactName || 'equipo'}:

${evidence}

En CompuApps SecureDev ofrecemos ${service}. Podríamos revisar un alcance adaptado a ${lead.needSummary || 'sus prioridades actuales'}, sin prometer una cotización hasta confirmar los requerimientos.

¿Tiene sentido conversar 20 minutos esta semana para definir necesidades, alcance y siguientes pasos?

Diego Monroy
CEO, CompuApps SecureDev
3165382561 | Cali, Colombia
`;
}
