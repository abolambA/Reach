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

// ============================================================
// REACH v2 — graph, goals, actions
// ============================================================

export type Person = {
  urn: string;
  public_id: string | null;
  name: string | null;
  headline: string | null;
  company: string | null;
  position: string | null;
  location: string | null;
  profile_url: string | null;
  profile_img: string | null;
  industry: string | null;
  is_self: boolean;
  is_first_degree: boolean;
  first_seen_at: string;
  last_seen_at: string;
  derived_categories: string[];
  notes: string | null;
};

export type Edge = {
  src_urn: string;
  dst_urn: string;
  edge_type: 'connected' | 'follows' | 'engages_with' | 'messaged';
  observed_at: string;
  confidence: number;
};

export type Post = {
  urn: string;
  author_urn: string | null;
  content: string | null;
  posted_at: string | null;
  like_count: number;
  comment_count: number;
  repost_count: number;
  is_self_authored: boolean;
  observed_at: string;
};

export type Goal = {
  id: string;
  label: string;
  kind: 'followers' | 'role_target' | 'named_person' | 'custom';
  criteria: Record<string, any>;
  target_value: number | null;
  current_value: number;
  status: 'active' | 'paused' | 'done' | 'archived';
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Action = {
  id: string;
  goal_id: string | null;
  kind: 'reply' | 'outreach' | 'intro_request' | 'comment' | 'react' | 'follow' | 'connect';
  target_urn: string | null;
  target_post_urn: string | null;
  via_urn: string | null;
  draft: string | null;
  rationale: string | null;
  status: 'queued' | 'approved' | 'sent' | 'skipped' | 'expired';
  priority: number;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
  expires_at: string | null;
};
