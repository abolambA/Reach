import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors, logIngest } from '../_helpers';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

type EdgeIn = {
  src_urn: string;
  dst_urn: string;
  edge_type: 'connected' | 'follows' | 'engages_with' | 'messaged';
  confidence?: number;
};

export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const { edges, source_url } = body as { edges: EdgeIn[]; source_url?: string };
    if (!Array.isArray(edges) || edges.length === 0) {
      return NextResponse.json({ error: 'no edges' }, { status: 400, headers: cors() });
    }

    const admin = createAdminClient();

    // Make sure every urn referenced exists in `people` (stub-insert if missing)
    const allUrns = new Set<string>();
    for (const e of edges) {
      if (e.src_urn) allUrns.add(e.src_urn);
      if (e.dst_urn) allUrns.add(e.dst_urn);
    }
    const stubs = Array.from(allUrns).map(urn => ({ urn }));
    await admin.from('people').upsert(stubs, { onConflict: 'urn', ignoreDuplicates: true });

    const now = new Date().toISOString();
    const rows = edges
      .filter(e => e.src_urn && e.dst_urn && e.edge_type)
      .map(e => ({
        src_urn: e.src_urn,
        dst_urn: e.dst_urn,
        edge_type: e.edge_type,
        confidence: e.confidence ?? 1.0,
        observed_at: now,
      }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, count: 0 }, { headers: cors() });
    }

    const { error } = await admin.from('edges').upsert(rows, {
      onConflict: 'src_urn,dst_urn,edge_type',
      ignoreDuplicates: false,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: cors() });
    }

    // If any of these are 1st-degree connections of self, mark them
    const { data: self } = await admin
      .from('people')
      .select('urn')
      .eq('is_self', true)
      .single();
    if (self) {
      const firstDegreeUrns = rows
        .filter(r => r.edge_type === 'connected' && (r.src_urn === self.urn || r.dst_urn === self.urn))
        .map(r => (r.src_urn === self.urn ? r.dst_urn : r.src_urn));
      if (firstDegreeUrns.length > 0) {
        await admin
          .from('people')
          .update({ is_first_degree: true })
          .in('urn', firstDegreeUrns);
      }
    }

    await logIngest('edges', source_url || null, rows.length, rows[0]);
    return NextResponse.json({ ok: true, count: rows.length }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
