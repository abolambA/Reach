export const CATEGORIES = [
  { id: 'Sales Pitch', short: 'Sales', color: '#B85450' },
  { id: 'Recruiter', short: 'Recruiter', color: '#3A6F8A' },
  { id: 'Job Inquiry', short: 'Job', color: '#5C7D4F' },
  { id: 'Networking', short: 'Network', color: '#B58339' },
  { id: 'Real Question', short: 'Question', color: '#6F4C8A' },
  { id: 'Personal', short: 'Personal', color: '#A85674' },
  { id: 'Spam/Bot', short: 'Spam', color: '#7A7A7A' },
  { id: 'Other', short: 'Other', color: '#4A5158' },
] as const;

export const STATUSES = [
  { id: 'pending', label: 'Pending', color: '#5D6671' },
  { id: 'replied', label: 'Replied', color: '#5C7D4F' },
  { id: 'archived', label: 'Archived', color: '#7A7A7A' },
  { id: 'followup', label: 'Follow-up', color: '#B58339' },
  { id: 'skipped', label: 'Skipped', color: '#B85450' },
] as const;

// Single-user mode: every record belongs to this implicit user. Anyone
// who opens the app acts as them. URL obscurity is the only access control.
export const DEFAULT_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export type Status = (typeof STATUSES)[number]['id'];
export type CategoryId = (typeof CATEGORIES)[number]['id'];

export type Thread = {
  id: string;
  account_id: string;
  external_id: string;
  title: string | null;
  participants: string[];
  first_message_at: string | null;
  last_message_at: string | null;
  message_count: number;
  preview: string | null;
};

export type Decision = {
  thread_id: string;
  category: string | null;
  status: Status;
  summary: string | null;
  suggested_reply: string | null;
  draft_reply: string | null;
  notes: string | null;
  urgency: 'low' | 'medium' | 'high' | null;
  worth_replying: boolean | null;
  ai_classified_at: string | null;
  updated_at: string;
};

export type Message = {
  id: string;
  thread_id: string;
  sender: string | null;
  sender_profile_url: string | null;
  content: string | null;
  subject: string | null;
  sent_at: string | null;
  direction: 'inbound' | 'outbound' | null;
};

export type LinkedInAccount = {
  id: string;
  owner_id: string;
  label: string;
  source: 'csv' | 'unipile';
  unipile_account_id: string | null;
  csv_uploaded_at: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export function formatRelativeDate(d: string | null | undefined): string {
  if (!d) return '';
  try {
    const date = new Date(d);
    const now = new Date();
    const diff = (now.getTime() - date.getTime()) / 1000;
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}
