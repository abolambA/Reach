import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

type PostIn = {
  urn: string;
  author_urn?: string;
  content?: string;
  posted_at?: string;
  like_count?: number;
  comment_count?: number;
  repost_count?: number;
  is_self_authored?: boolean;
  raw?: any;
};

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { posts, source_url } = body as { posts: PostIn[]; source_url?: string };
    if (!Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json({ error: 'no posts' }, { status: 400, headers: cors() });
    }

    const admin = createAdminClient();
    // Stub-create authors if needed
    const authorUrns = posts.map(p => p.author_urn).filter(Boolean) as string[];
    if (authorUrns.length > 0) {
      await admin
        .from('people')
        .upsert(authorUrns.map(urn => ({ urn })), { onConflict: 'urn', ignoreDuplicates: true });
    }

    const rows = posts
      .filter(p => p.urn)
      .map(p => ({
        urn: p.urn,
        author_urn: p.author_urn || null,
        content: p.content || null,
        posted_at: p.posted_at || null,
        like_count: p.like_count || 0,
        comment_count: p.comment_count || 0,
        repost_count: p.repost_count || 0,
        is_self_authored: !!p.is_self_authored,
        observed_at: new Date().toISOString(),
        raw: p.raw || null,
      }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, count: 0 }, { headers: cors() });
    }

    const { error } = await admin
      .from('posts')
      .upsert(rows, { onConflict: 'urn', ignoreDuplicates: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: cors() });
    }
    await logIngest('posts', source_url || null, rows.length, rows[0]);
    return NextResponse.json({ ok: true, count: rows.length }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
