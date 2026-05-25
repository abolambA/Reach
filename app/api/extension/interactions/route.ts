import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

type InteractionIn = {
  actor_urn: string;
  post_urn: string;
  kind: 'like' | 'reaction' | 'comment' | 'repost';
  content?: string;
  at?: string;
};

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { interactions, source_url } = body as {
      interactions: InteractionIn[];
      source_url?: string;
    };
    if (!Array.isArray(interactions) || interactions.length === 0) {
      return NextResponse.json({ error: 'no interactions' }, { status: 400, headers: cors() });
    }

    const admin = createAdminClient();

    // Stub-create any missing people / posts
    const personUrns = new Set<string>();
    const postUrns = new Set<string>();
    for (const i of interactions) {
      if (i.actor_urn) personUrns.add(i.actor_urn);
      if (i.post_urn) postUrns.add(i.post_urn);
    }
    if (personUrns.size > 0) {
      await admin
        .from('people')
        .upsert([...personUrns].map(urn => ({ urn })), { onConflict: 'urn', ignoreDuplicates: true });
    }
    if (postUrns.size > 0) {
      await admin
        .from('posts')
        .upsert([...postUrns].map(urn => ({ urn })), { onConflict: 'urn', ignoreDuplicates: true });
    }

    const rows = interactions
      .filter(i => i.actor_urn && i.post_urn && i.kind)
      .map(i => ({
        actor_urn: i.actor_urn,
        post_urn: i.post_urn,
        kind: i.kind,
        content: i.content || null,
        at: i.at || new Date().toISOString(),
      }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, count: 0 }, { headers: cors() });
    }

    const { error } = await admin.from('interactions').upsert(rows, {
      onConflict: 'actor_urn,post_urn,kind',
      ignoreDuplicates: false,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: cors() });
    }
    await logIngest('interactions', source_url || null, rows.length, rows[0]);
    return NextResponse.json({ ok: true, count: rows.length }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
