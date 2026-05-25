import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { target_urn, max_depth } = await req.json();
    if (!target_urn) {
      return NextResponse.json({ error: 'missing target_urn' }, { status: 400 });
    }
    const admin = createAdminClient();

    // Find self
    const { data: self } = await admin
      .from('people')
      .select('urn')
      .eq('is_self', true)
      .single();
    if (!self) {
      return NextResponse.json(
        { error: 'No self user identified yet. Visit your own profile in LinkedIn with the extension installed.' },
        { status: 400 },
      );
    }

    // Check cache first
    const { data: cached } = await admin
      .from('path_cache')
      .select('path, length, computed_at')
      .eq('src_urn', self.urn)
      .eq('dst_urn', target_urn)
      .single();
    if (cached && new Date(cached.computed_at).getTime() > Date.now() - 24 * 3600 * 1000) {
      return await enrichAndReturn(cached.path, cached.length);
    }

    // Run BFS
    const { data, error } = await admin.rpc('find_path', {
      start_urn: self.urn,
      end_urn: target_urn,
      max_depth: max_depth || 4,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return NextResponse.json({ path: null, length: null });
    }
    // pgsql returned an array; data is text[]
    const pathArray: string[] = Array.isArray(data) ? data : [];

    // Cache it
    await admin.from('path_cache').upsert({
      src_urn: self.urn,
      dst_urn: target_urn,
      path: pathArray,
      length: pathArray.length - 1,
    });

    return await enrichAndReturn(pathArray, pathArray.length - 1);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function enrichAndReturn(path: string[], length: number) {
  const admin = createAdminClient();
  const { data: people } = await admin
    .from('people')
    .select('urn, name, headline, company, profile_url, profile_img, is_first_degree')
    .in('urn', path);

  // Preserve path order
  const personMap = new Map((people || []).map(p => [p.urn, p]));
  const orderedPeople = path.map(urn => personMap.get(urn) || { urn });

  return NextResponse.json({
    path,
    length,
    people: orderedPeople,
  });
}
