import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

// GET — return the currently-flagged self
export async function GET(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  const admin = createAdminClient();
  const { data } = await admin
    .from('people')
    .select('urn, name, public_id, headline')
    .eq('is_self', true)
    .single();
  return NextResponse.json({ self: data || null }, { headers: cors() });
}

// POST — extension declares "this profile is me"
export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { urn, name, public_id, headline, profile_url, profile_img } = body;
    if (!urn) {
      return NextResponse.json({ error: 'missing urn' }, { status: 400, headers: cors() });
    }
    const admin = createAdminClient();
    // Clear any previous self flag, then set this one
    await admin.from('people').update({ is_self: false }).eq('is_self', true);
    await admin.from('people').upsert({
      urn,
      name,
      public_id,
      headline,
      profile_url,
      profile_img,
      is_self: true,
      is_first_degree: true,
      last_seen_at: new Date().toISOString(),
    });
    await logIngest('self', null, 1, { urn });
    return NextResponse.json({ ok: true }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
