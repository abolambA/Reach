import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  const admin = createAdminClient();
  let query = admin
    .from('people')
    .select('urn, public_id, name, headline, company, profile_url, profile_img, is_first_degree, derived_categories')
    .eq('is_self', false);

  if (q) {
    // If the query looks like a LinkedIn profile URL or /in/<handle>, extract the handle
    const urlMatch = q.match(/linkedin\.com\/in\/([^/?#\s]+)/i) || q.match(/^\/?in\/([^/?#\s]+)/i);
    if (urlMatch) {
      const publicId = urlMatch[1];
      query = query.or(`public_id.eq.${publicId},profile_url.ilike.%${publicId}%`);
    } else {
      // Free-text search across name, headline, company, position, public_id
      const escaped = q.replace(/[%_]/g, '\\$&');
      query = query.or(
        `name.ilike.%${escaped}%,headline.ilike.%${escaped}%,company.ilike.%${escaped}%,position.ilike.%${escaped}%,public_id.ilike.%${escaped}%`
      );
    }
  }

  const { data, error } = await query
    .order('is_first_degree', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ people: data || [] });
}
