import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { checkAuth, cors } from '../_helpers';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

// Diagnostic sink: the content script posts what it sees on the page here so we
// can debug the scraper from the DB without reading the browser console.
export async function POST(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  try {
    const body = await req.json();
    const admin = createAdminClient();
    await admin.from('ingest_log').insert({
      kind: 'debug',
      url: body?.path || null,
      count: 0,
      raw_sample: body ?? null,
    });
    return NextResponse.json({ ok: true }, { headers: cors() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors() });
  }
}
