import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

  const admin = createAdminClient();
  let q = admin
    .from('actions')
    .select('*, target:people!actions_target_urn_fkey(urn,name,headline,company,profile_img,profile_url), via:people!actions_via_urn_fkey(urn,name,headline), goal:goals(id,label)')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ actions: data || [] });
}
