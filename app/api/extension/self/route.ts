import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  const admin = createAdminClient();
  const { data } = await admin
    .from('people')
    .select('urn, name, public_id, headline')
    .eq('is_self', true)
    .maybeSingle();
  return NextResponse.json({ self: data || null }, { headers: cors() });
}

// POST — extension declares "this profile is me". Merge mode: never null-out good fields.
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

    // Read existing record (if any) so we can preserve fields the extension didn't send
    const { data: existing } = await admin
      .from('people')
      .select('urn, name, public_id, headline, profile_url, profile_img')
      .eq('urn', urn)
      .maybeSingle();

    const row = {
      urn,
      name: (name && String(name).trim()) || existing?.name || null,
      public_id: public_id || existing?.public_id || null,
      headline: (headline && String(headline).trim()) || existing?.headline || null,
      profile_url: profile_url || existing?.profile_url || null,
      profile_img: profile_img || existing?.profile_img || null,
      is_self: true,
      is_first_degree: true,
      last_seen_at: new Date().toISOString(),
    };

    const { error } = await admin.from('people').upsert(row, { onConflict: 'urn' });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: cors() });
    }
    await logIngest('self', null, 1, { urn });
    return NextResponse.json({ ok: true }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
