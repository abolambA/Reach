import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors } from '../_helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

// Returns real DB-side counts. Extension uses this for accurate display.
export async function GET(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;

  const admin = createAdminClient();
  const [
    { count: peopleCount },
    { count: edgesCount },
    { count: messagesCount },
    { count: postsCount },
    { count: selfCount },
  ] = await Promise.all([
    admin.from('people').select('*', { count: 'exact', head: true }).eq('is_self', false),
    admin.from('edges').select('*', { count: 'exact', head: true }),
    admin.from('messages').select('*', { count: 'exact', head: true }),
    admin.from('posts').select('*', { count: 'exact', head: true }),
    admin.from('people').select('*', { count: 'exact', head: true }).eq('is_self', true),
  ]);

  return NextResponse.json({
    people: peopleCount || 0,
    edges: edgesCount || 0,
    messages: messagesCount || 0,
    posts: postsCount || 0,
    has_self: (selfCount || 0) > 0,
  }, { headers: cors() });
}
