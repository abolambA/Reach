import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { classifyBatch, type ThreadForClassify } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { thread_ids } = (await req.json()) as { thread_ids: string[] };
    if (!thread_ids || thread_ids.length === 0) {
      return NextResponse.json({ error: 'no thread_ids' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: threads, error: tErr } = await admin
      .from('threads')
      .select('id, title, participants, messages(sender, content, sent_at, direction)')
      .in('id', thread_ids);

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    if (!threads || threads.length === 0) {
      return NextResponse.json({ error: 'no threads' }, { status: 404 });
    }

    const forClassify: ThreadForClassify[] = threads.map((t: any) => {
      const msgs = (t.messages || [])
        .filter((m: any) => m.direction !== 'outbound')
        .sort((a: any, b: any) => +new Date(a.sent_at || 0) - +new Date(b.sent_at || 0))
        .slice(0, 4)
        .map((m: any) => `[${m.sender || 'unknown'}]: ${(m.content || '').slice(0, 500)}`)
        .join('\n---\n');
      return {
        thread_id: t.id,
        from: (t.participants || []).join(', ') || (t.title || ''),
        title: t.title || '',
        excerpt: msgs,
      };
    });

    const results = await classifyBatch(forClassify);

    const now = new Date().toISOString();
    const updates = results.map(r => ({
      thread_id: r.thread_id,
      category: r.category,
      summary: r.summary,
      suggested_reply: r.suggested_reply,
      draft_reply: r.suggested_reply,
      urgency: r.urgency,
      worth_replying: r.worth_replying,
      ai_classified_at: now,
      status: 'pending' as const,
    }));

    const { error: upErr } = await admin
      .from('decisions')
      .upsert(updates, { onConflict: 'thread_id' });

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ classified: results.length });
  } catch (e: any) {
    console.error('Classify error:', e);
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
