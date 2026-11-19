import express from 'express';
import fs from 'fs';
import path from 'path';

export const salesAgentRouter = express.Router();

const DATA_DIR = path.resolve(process.cwd(), 'workspace', 'sales-agent');
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');

function readJson(file: string): any[] {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function sendLimitReached(email: string) {
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const sent = readJson(EMAILS_FILE).filter((item) => item.status === 'sent' && item.sentAt?.startsWith(dayKey));
  return { reached: sent.length >= 10, sent: sent.length, limit: 10 };
}

salesAgentRouter.get('/api/sales/leads', (_req, res) => {
  res.json({ leads: readJson(LEADS_FILE) });
});

salesAgentRouter.post('/api/sales/leads', (req, res) => {
  const body = req.body || {};
  if (!String(body.email || '').includes('@')) return res.status(400).json({ error: 'Correo electrónico inválido.' });
  const leads = readJson(LEADS_FILE);
  if (leads.some((lead) => lead.email.toLowerCase() === String(body.email).toLowerCase())) {
    return res.status(409).json({ error: 'El prospecto ya existe.' });
  }
  const now = new Date().toISOString();
  const lead = {
    id: `lead-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    companyName: String(body.companyName || '').trim(),
    contactName: String(body.contactName || '').trim(),
    email: String(body.email).trim(),
    country: String(body.country || '').trim(),
    city: String(body.city || '').trim(),
    website: String(body.website || '').trim(),
    industry: String(body.industry || '').trim(),
    needSummary: String(body.needSummary || '').trim(),
    recommendedService: body.recommendedService,
    evidenceUrls: Array.isArray(body.evidenceUrls) ? body.evidenceUrls : [],
    status: 'new',
    consentStatus: body.consentStatus || 'unknown',
    source: String(body.source || 'manual'),
    sourceId: body.sourceId,
    createdAt: now,
    updatedAt: now,
    followUpsSent: 0,
  };
  leads.unshift(lead);
  writeJson(LEADS_FILE, leads);
  res.status(201).json({ lead });
});

salesAgentRouter.post('/api/sales/emails/queue', (req, res) => {
  const limit = sendLimitReached(String(req.body?.email || ''));
  if (limit.reached) return res.status(429).json({ error: 'Se alcanzó el límite diario de 10 correos.', limit });
  const leads = readJson(LEADS_FILE);
  const lead = leads.find((item) => item.id === req.body?.leadId);
  if (!lead) return res.status(404).json({ error: 'Prospecto no encontrado.' });
  if (lead.consentStatus === 'opted-out' || lead.status === 'blocked') {
    return res.status(400).json({ error: 'El prospecto solicitó no recibir comunicaciones.' });
  }
  const emails = readJson(EMAILS_FILE);
  const email = {
    id: `email-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    leadId: lead.id,
    subject: String(req.body?.subject || '').trim(),
    body: String(req.body?.body || '').trim(),
    status: 'queued',
    kind: req.body?.kind || 'first-contact',
    createdAt: new Date().toISOString(),
  };
  emails.unshift(email);
  writeJson(EMAILS_FILE, emails);
  res.status(202).json({ email, limit });
});

salesAgentRouter.get('/api/sales/emails', (_req, res) => {
  res.json({ emails: readJson(EMAILS_FILE), limit: sendLimitReached('') });
});

salesAgentRouter.get('/api/sales/report/daily', (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const leads = readJson(LEADS_FILE);
  const emails = readJson(EMAILS_FILE);
  const report = {
    id: `report-${date}`,
    date,
    leadsDiscovered: leads.filter((lead) => lead.createdAt?.startsWith(date)).length,
    leadsQualified: leads.filter((lead) => lead.updatedAt?.startsWith(date) && lead.recommendedService).length,
    emailsSent: emails.filter((email) => email.status === 'sent' && email.sentAt?.startsWith(date)).length,
    emailsFailed: emails.filter((email) => email.status === 'failed' && email.createdAt?.startsWith(date)).length,
    replies: leads.filter((lead) => lead.status === 'replied' && lead.updatedAt?.startsWith(date)).length,
    meetings: leads.filter((lead) => lead.status === 'meeting' && lead.updatedAt?.startsWith(date)).length,
    won: leads.filter((lead) => lead.status === 'won' && lead.updatedAt?.startsWith(date)).length,
    generatedAt: new Date().toISOString(),
  };
  res.json({ report });
});
