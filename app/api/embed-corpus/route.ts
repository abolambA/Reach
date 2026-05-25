import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { embedBatch } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Pulls outbound messages and self-authored posts, embeds any not yet embedded.
// Safe to call repeatedly — only embeds new items.
export async function POST() {
  try {
    const admin = createAdminClient();
    let inserted = 0;

    // 1. Outbound messages not yet in corpus
    const { data: outboundMsgs } = await admin
      .from('messages')
      .select('id, content, sent_at')
      .eq('direction', 'outbound')
      .not('content', 'is', null)
      .limit(200);

    const existingMsgIds = await admin
      .from('style_corpus')
      .select('source_ref')
      .eq('source_kind', 'sent_message');
    const existingMsgSet = new Set((existingMsgIds.data || []).map(r => r.source_ref));

    const newMsgs = (outboundMsgs || []).filter(
      m => !existingMsgSet.has(m.id) && (m.content || '').length > 20,
    );

    if (newMsgs.length > 0) {
      const embeddings = await embedBatch(newMsgs.map(m => m.content || ''));
      const rows = newMsgs.map((m, i) => ({
        source_kind: 'sent_message' as const,
        source_ref: m.id,
        text: m.content || '',
        embedding: `[${embeddings[i].join(',')}]` as any,
        written_at: m.sent_at,
      }));
      await admin.from('style_corpus').insert(rows);
      inserted += rows.length;
    }

    // 2. Self-authored posts
    const { data: selfPosts } = await admin
      .from('posts')
      .select('urn, content, posted_at')
      .eq('is_self_authored', true)
      .not('content', 'is', null)
      .limit(200);

    const existingPostIds = await admin
      .from('style_corpus')
      .select('source_ref')
      .eq('source_kind', 'post');
    const existingPostSet = new Set((existingPostIds.data || []).map(r => r.source_ref));

    const newPosts = (selfPosts || []).filter(
      p => !existingPostSet.has(p.urn) && (p.content || '').length > 40,
    );

    if (newPosts.length > 0) {
      const embeddings = await embedBatch(newPosts.map(p => p.content || ''));
      const rows = newPosts.map((p, i) => ({
        source_kind: 'post' as const,
        source_ref: p.urn,
        text: p.content || '',
        embedding: `[${embeddings[i].join(',')}]` as any,
        written_at: p.posted_at,
      }));
      await admin.from('style_corpus').insert(rows);
      inserted += rows.length;
    }

    return NextResponse.json({ ok: true, embedded: inserted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
