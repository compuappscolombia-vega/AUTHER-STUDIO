export type LeadStatus = 'new' | 'researched' | 'qualified' | 'contacted' | 'replied' | 'meeting' | 'won' | 'lost' | 'blocked';
export type SalesServiceId = 'aura-agent' | 'control-ventory' | 'commercial-media' | 'vega-cam' | 'web-mobile' | 'pentesting' | 'automation' | 'software-rental' | 'courses' | 'remote-support';

export interface SalesLead {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  country?: string;
  city?: string;
  website?: string;
  industry?: string;
  needSummary?: string;
  recommendedService?: SalesServiceId;
  evidenceUrls: string[];
  status: LeadStatus;
  consentStatus: 'unknown' | 'legitimate-contact' | 'opted-out';
  source: string;
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string;
  followUpsSent: number;
  unsubscribedAt?: string;
}

export interface SalesEmail {
  id: string;
  leadId: string;
  providerMessageId?: string;
  subject: string;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'bounced';
  kind: 'first-contact' | 'follow-up' | 'reply';
  error?: string;
  createdAt: string;
  sentAt?: string;
}

export interface SalesDailyReport {
  id: string;
  date: string;
  leadsDiscovered: number;
  leadsQualified: number;
  emailsSent: number;
  emailsFailed: number;
  replies: number;
  meetings: number;
  won: number;
  generatedAt: string;
}
