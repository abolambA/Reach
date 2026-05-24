// Unipile API wrapper.
// Docs: https://developer.unipile.com/reference
//
// Unipile is the third-party service we use to talk to LinkedIn messaging.
// LinkedIn has no public messaging API; Unipile maintains a logged-in session
// on the user's behalf after they authorize through Unipile's hosted login.

export type UnipileChat = {
  id: string;
  name?: string;
  type: number;
  attendees?: Array<{ name?: string; provider_id?: string }>;
  last_message_date?: string;
  unread_count?: number;
};

export type UnipileMessage = {
  id: string;
  chat_id: string;
  text?: string;
  sender_id?: string;
  sender_attendee?: { name?: string };
  timestamp?: string;
  is_sender?: 1 | 0;
};

const apiKey = () => process.env.UNIPILE_API_KEY!;
const dsn = () => process.env.UNIPILE_DSN!; // e.g. https://apiXXX.unipile.com:13XXX

function headers() {
  return {
    'X-API-KEY': apiKey(),
    'accept': 'application/json',
    'content-type': 'application/json',
  };
}

export function unipileConfigured(): boolean {
  return !!process.env.UNIPILE_API_KEY && !!process.env.UNIPILE_DSN;
}

// Create a hosted auth link the manager clicks to log into LinkedIn through
// Unipile. Returns a URL. Unipile will redirect to `success_redirect_url`
// after auth, with the account_id in the URL.
export async function createHostedAuthLink(opts: {
  successRedirectUrl: string;
  failureRedirectUrl: string;
  expiresAt: Date;
  name?: string;
}): Promise<{ url: string }> {
  const res = await fetch(`${dsn()}/api/v1/hosted/accounts/link`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'create',
      providers: ['LINKEDIN'],
      api_url: dsn(),
      expiresOn: opts.expiresAt.toISOString(),
      success_redirect_url: opts.successRedirectUrl,
      failure_redirect_url: opts.failureRedirectUrl,
      name: opts.name,
    }),
  });
  if (!res.ok) throw new Error(`Unipile link error: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function listChats(accountId: string, limit = 100): Promise<UnipileChat[]> {
  const all: UnipileChat[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(`${dsn()}/api/v1/chats`);
    url.searchParams.set('account_id', accountId);
    url.searchParams.set('limit', String(Math.min(limit - all.length, 50)));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`Unipile listChats: ${res.status} ${await res.text()}`);
    const data = await res.json();
    all.push(...(data.items || []));
    cursor = data.cursor;
    if (all.length >= limit) break;
  } while (cursor);
  return all;
}

export async function listMessages(chatId: string, limit = 50): Promise<UnipileMessage[]> {
  const url = new URL(`${dsn()}/api/v1/chats/${chatId}/messages`);
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Unipile listMessages: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.items || [];
}
