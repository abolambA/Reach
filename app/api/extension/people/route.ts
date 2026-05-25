import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

type PersonIn = {
  urn: string;
  public_id?: string;
  name?: string;
  headline?: string;
  company?: string;
  position?: string;
  location?: string;
  profile_url?: string;
  profile_img?: string;
  industry?: string;
  is_first_degree?: boolean;
  raw?: Record<string, any>;
};

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { people, source_url } = body as { people: PersonIn[]; source_url?: string };
    if (!Array.isArray(people) || people.length === 0) {
      return NextResponse.json({ error: 'no people' }, { status: 400, headers: cors() });
    }

    const now = new Date().toISOString();
    const rows = people
      .filter(p => p.urn && typeof p.urn === 'string')
      .map(p => ({
        urn: p.urn,
        public_id: p.public_id || null,
        name: p.name || null,
        headline: p.headline || null,
        company: p.company || null,
        position: p.position || null,
        location: p.location || null,
        profile_url: p.profile_url || null,
        profile_img: p.profile_img || null,
        industry: p.industry || null,
        is_first_degree: !!p.is_first_degree,
        last_seen_at: now,
        raw: p.raw || null,
      }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, count: 0 }, { headers: cors() });
    }

    const admin = createAdminClient();
    // Upsert WITHOUT overwriting first_seen_at; ignore is_self
    const { error } = await admin.from('people').upsert(rows, {
      onConflict: 'urn',
      ignoreDuplicates: false,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: cors() });
    }
    await logIngest('people', source_url || null, rows.length, rows[0]);
    return NextResponse.json({ ok: true, count: rows.length }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
