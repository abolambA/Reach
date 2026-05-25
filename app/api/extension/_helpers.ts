import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

// The extension authenticates with a shared bearer token (REACH_INGEST_TOKEN).
// Not real auth — just keeps random people from spamming the endpoint.
export function checkAuth(req: Request): NextResponse | null {
  const expected = process.env.REACH_INGEST_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: 'REACH_INGEST_TOKEN not configured on server' },
      { status: 500 },
    );
  }
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (got !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function logIngest(
  kind: string,
  url: string | null,
  count: number,
  rawSample?: any,
) {
  const admin = createAdminClient();
  await admin.from('ingest_log').insert({
    kind,
    url,
    count,
    raw_sample: rawSample ?? null,
  });
}

export function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function OPTIONS_handler() {
  return new NextResponse(null, { status: 204, headers: cors() });
}
