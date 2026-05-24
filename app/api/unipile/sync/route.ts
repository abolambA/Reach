import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { listChats, listMessages, unipileConfigured } from '@/lib/unipile';
import { DEFAULT_OWNER_ID } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    if (!unipileConfigured()) {
      return NextResponse.redirect(new URL('/import?error=unipile_not_configured', req.url));
    }

    const url = new URL(req.url);
    const accountId = url.searchParams.get('account_id');
    const label = url.searchParams.get('label') || 'LinkedIn';
    if (!accountId) return NextResponse.redirect(new URL('/import?error=no_account_id', req.url));

    const admin = createAdminClient();
    const { data: account, error: aErr } = await admin
      .from('linkedin_accounts')
      .insert({
        owner_id: DEFAULT_OWNER_ID,
        label,
        source: 'unipile',
        unipile_account_id: accountId,
        last_synced_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (aErr || !account) {
      return NextResponse.redirect(new URL(`/import?error=${encodeURIComponent(aErr?.message || 'insert_failed')}`, req.url));
    }

    await syncAccount(account.id, accountId);
    return NextResponse.redirect(new URL('/triage', req.url));
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/import?error=${encodeURIComponent(e.message)}`, req.url));
  }
}

export async function POST(req: Request) {
  try {
    const { account_id } = await req.json();
    const admin = createAdminClient();
    const { data: account } = await admin
      .from('linkedin_accounts')
      .select('*')
      .eq('id', account_id)
      .single();
    if (!account || !account.unipile_account_id) {
      return NextResponse.json({ error: 'unipile account not found' }, { status: 404 });
    }
    const count = await syncAccount(account.id, account.unipile_account_id);
    return NextResponse.json({ synced: count });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function syncAccount(localAccountId: string, unipileAccountId: string): Promise<number> {
  const admin = createAdminClient();
  const chats = await listChats(unipileAccountId, 100);

  const threadRows = chats.map(c => ({
    account_id: localAccountId,
    external_id: c.id,
    title: c.name || c.attendees?.[0]?.name || '(no title)',
    participants: (c.attendees || []).map(a => a.name).filter(Boolean) as string[],
    last_message_at: c.last_message_date || new Date().toISOString(),
    first_message_at: c.last_message_date || new Date().toISOString(),
    message_count: 0,
    preview: '',
  }));

  const { data: insertedThreads } = await admin
    .from('threads')
    .upsert(threadRows, { onConflict: 'account_id,external_id' })
    .select('id, external_id');

  const idMap = new Map<string, string>();
  for (const r of insertedThreads || []) idMap.set(r.external_id, r.id);

  let total = 0;
  for (const chat of chats) {
    const tid = idMap.get(chat.id);
    if (!tid) continue;
    const msgs = await listMessages(chat.id, 30);
    const msgRows = msgs.map(m => ({
      thread_id: tid,
      external_id: m.id,
      sender: m.sender_attendee?.name || m.sender_id || '',
      content: m.text || '',
      sent_at: m.timestamp || new Date().toISOString(),
      direction: m.is_sender === 1 ? ('outbound' as const) : ('inbound' as const),
    }));
    if (msgRows.length) {
      await admin.from('messages').insert(msgRows);
      const preview = msgRows[0]?.content?.slice(0, 200) || '';
      await admin
        .from('threads')
        .update({ message_count: msgRows.length, preview })
        .eq('id', tid);
    }
    await admin
      .from('decisions')
      .upsert({ thread_id: tid, status: 'pending' as const }, { onConflict: 'thread_id' });
    total++;
  }

  await admin
    .from('linkedin_accounts')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', localAccountId);

  return total;
}
