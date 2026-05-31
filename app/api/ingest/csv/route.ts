import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { parseLinkedInCSV } from '@/lib/parse-linkedin-csv';
import { DEFAULT_OWNER_ID } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { label, ownerName, csv } = body as { label: string; ownerName?: string; csv: string };
    if (!csv || !label) return NextResponse.json({ error: 'missing csv or label' }, { status: 400 });

    const parsed = parseLinkedInCSV(csv, ownerName);
    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No threads parsed from CSV. Check the format.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: account, error: accountErr } = await admin
      .from('linkedin_accounts')
      .insert({
        owner_id: DEFAULT_OWNER_ID,
        label,
        source: 'csv',
        csv_uploaded_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (accountErr || !account) {
      return NextResponse.json({ error: accountErr?.message || 'Failed to create account' }, { status: 500 });
    }

    const threadRows = parsed.map(t => ({
      account_id: account.id,
      external_id: t.external_id,
      title: t.title,
      participants: t.participants,
      first_message_at: t.first_message_at,
      last_message_at: t.last_message_at,
      message_count: t.messages.length,
      preview: t.preview,
    }));

    const { data: insertedThreads, error: threadErr } = await admin
      .from('threads')
      .upsert(threadRows, { onConflict: 'account_id,external_id' })
      .select('id, external_id');

    if (threadErr) return NextResponse.json({ error: threadErr.message }, { status: 500 });

    const idMap = new Map<string, string>();
    for (const r of insertedThreads || []) idMap.set(r.external_id, r.id);

    const messageRows = parsed.flatMap(t => {
      const tid = idMap.get(t.external_id);
      if (!tid) return [];
      return t.messages.map(m => ({
        thread_id: tid,
        sender: m.sender,
        sender_profile_url: m.sender_profile_url,
        content: m.content,
        subject: m.subject,
        sent_at: m.sent_at,
        direction: m.direction,
      }));
    });

    for (let i = 0; i < messageRows.length; i += 500) {
      const chunk = messageRows.slice(i, i + 500);
      const { error: msgErr } = await admin.from('messages').insert(chunk);
      if (msgErr) console.error('message insert error:', msgErr);
    }

    const decisionRows = (insertedThreads || []).map(t => ({
      thread_id: t.id,
      status: 'pending' as const,
    }));
    if (decisionRows.length > 0) {
      await admin.from('decisions').upsert(decisionRows, { onConflict: 'thread_id' });
    }

    return NextResponse.json({
      account_id: account.id,
      thread_ids: (insertedThreads || []).map(t => t.id),
      count: insertedThreads?.length || 0,
    });
  } catch (e: any) {
    console.error('CSV ingest error:', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
