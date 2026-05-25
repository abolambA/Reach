import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';
import { DEFAULT_OWNER_ID } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

type ThreadIn = {
  external_id: string;            // LinkedIn conversation URN
  title?: string;
  participants?: string[];        // names
  participant_urns?: string[];
  messages: {
    external_id?: string;
    sender?: string;
    sender_urn?: string;
    content: string;
    sent_at?: string;
    direction: 'inbound' | 'outbound';
  }[];
};

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { threads, source_url } = body as { threads: ThreadIn[]; source_url?: string };
    if (!Array.isArray(threads) || threads.length === 0) {
      return NextResponse.json({ error: 'no threads' }, { status: 400, headers: cors() });
    }

    const admin = createAdminClient();

    // Get or create the default "extension-sourced" linkedin_account
    let { data: account } = await admin
      .from('linkedin_accounts')
      .select('id')
      .eq('owner_id', DEFAULT_OWNER_ID)
      .eq('source', 'csv')
      .eq('label', 'LinkedIn (extension)')
      .maybeSingle();

    if (!account) {
      const insert = await admin
        .from('linkedin_accounts')
        .insert({
          owner_id: DEFAULT_OWNER_ID,
          label: 'LinkedIn (extension)',
          source: 'csv',
          last_synced_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      account = insert.data!;
    }

    const accountId = account.id;
    let totalThreads = 0;
    let totalMessages = 0;

    for (const t of threads) {
      if (!t.external_id || !t.messages?.length) continue;
      const sortedMsgs = [...t.messages].sort(
        (a, b) => +new Date(a.sent_at || 0) - +new Date(b.sent_at || 0),
      );
      const lastAt = sortedMsgs[sortedMsgs.length - 1].sent_at || new Date().toISOString();
      const firstAt = sortedMsgs[0].sent_at || lastAt;

      const { data: threadRow } = await admin
        .from('threads')
        .upsert(
          {
            account_id: accountId,
            external_id: t.external_id,
            title: t.title || t.participants?.[0] || null,
            participants: t.participants || [],
            first_message_at: firstAt,
            last_message_at: lastAt,
            message_count: sortedMsgs.length,
            preview: (sortedMsgs[0]?.content || '').slice(0, 200),
          },
          { onConflict: 'account_id,external_id' },
        )
        .select('id')
        .single();

      if (!threadRow) continue;
      totalThreads++;

      // Insert messages, dedupe via (thread_id, sent_at, content) heuristic
      const msgRows = sortedMsgs.map(m => ({
        thread_id: threadRow.id,
        sender: m.sender || null,
        content: m.content || '',
        sent_at: m.sent_at || new Date().toISOString(),
        direction: m.direction,
      }));

      // Naive dedupe: delete any existing rows for this thread that match, then insert.
      // For a passive observer this is fine; volume is low.
      const { data: existing } = await admin
        .from('messages')
        .select('id, sent_at, content')
        .eq('thread_id', threadRow.id);
      const existingKeys = new Set(
        (existing || []).map(e => `${e.sent_at}|${(e.content || '').slice(0, 60)}`),
      );
      const newMsgs = msgRows.filter(
        m => !existingKeys.has(`${m.sent_at}|${(m.content || '').slice(0, 60)}`),
      );
      if (newMsgs.length > 0) {
        await admin.from('messages').insert(newMsgs);
        totalMessages += newMsgs.length;
      }

      // Initialize a pending decision row
      await admin
        .from('decisions')
        .upsert({ thread_id: threadRow.id, status: 'pending' }, { onConflict: 'thread_id' });
    }

    await logIngest('messages', source_url || null, totalMessages, threads[0]);
    return NextResponse.json(
      { ok: true, threads: totalThreads, messages: totalMessages },
      { headers: cors() },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
