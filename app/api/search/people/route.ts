import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  const admin = createAdminClient();
  let query = admin
    .from('people')
    .select('urn, name, headline, company, profile_url, profile_img, is_first_degree, derived_categories')
    .eq('is_self', false);

  if (q) {
    // ILIKE across multiple columns
    query = query.or(`name.ilike.%${q}%,headline.ilike.%${q}%,company.ilike.%${q}%`);
  }

  const { data, error } = await query
    .order('is_first_degree', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ people: data || [] });
}
