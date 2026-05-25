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
  public_id?: string | null;
  name?: string | null;
  headline?: string | null;
  company?: string | null;
  position?: string | null;
  location?: string | null;
  profile_url?: string | null;
  profile_img?: string | null;
  industry?: string | null;
  is_first_degree?: boolean;
  raw?: Record<string, any> | null;
};

// Only keep keys whose value is meaningful (non-empty string, true boolean, non-null object).
// This is what lets us MERGE incoming data with existing rows without nuking good fields.
function compact(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { people, source_url } = body as { people: PersonIn[]; source_url?: string };
    if (!Array.isArray(people) || people.length === 0) {
      return NextResponse.json({ error: 'no people' }, { status: 400, headers: cors() });
    }

    const valid = people.filter(p => p.urn && typeof p.urn === 'string');
    if (valid.length === 0) {
      return NextResponse.json({ ok: true, count: 0 }, { headers: cors() });
    }

    const admin = createAdminClient();
    const urns = valid.map(p => p.urn);

    // Pull existing rows so we can MERGE rather than overwrite
    const { data: existingRows } = await admin
      .from('people')
      .select('urn, public_id, name, headline, company, position, location, profile_url, profile_img, industry, is_first_degree, is_self, raw')
      .in('urn', urns);
    const existingMap = new Map<string, any>();
    for (const r of existingRows || []) existingMap.set(r.urn, r);

    const now = new Date().toISOString();
    const rows = valid.map(p => {
      const existing = existingMap.get(p.urn) || {};
      // Merge: prefer incoming non-null/non-empty values, fall back to existing
      const incoming = compact({
        public_id: p.public_id,
        name: p.name,
        headline: p.headline,
        company: p.company,
        position: p.position,
        location: p.location,
        profile_url: p.profile_url,
        profile_img: p.profile_img,
        industry: p.industry,
        raw: p.raw,
      });
      return {
        urn: p.urn,
        public_id: incoming.public_id ?? existing.public_id ?? null,
        name: incoming.name ?? existing.name ?? null,
        headline: incoming.headline ?? existing.headline ?? null,
        company: incoming.company ?? existing.company ?? null,
        position: incoming.position ?? existing.position ?? null,
        location: incoming.location ?? existing.location ?? null,
        profile_url: incoming.profile_url ?? existing.profile_url ?? null,
        profile_img: incoming.profile_img ?? existing.profile_img ?? null,
        industry: incoming.industry ?? existing.industry ?? null,
        // is_first_degree: latch true (once a first-degree, always)
        is_first_degree: existing.is_first_degree || !!p.is_first_degree,
        // is_self: never modify via the people endpoint (only the self endpoint sets it)
        is_self: existing.is_self ?? false,
        last_seen_at: now,
        raw: incoming.raw ?? existing.raw ?? null,
      };
    });

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
