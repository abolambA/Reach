import { NextResponse } from 'next/server';
import { checkAuth, cors } from '../_helpers';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

export async function GET(req: Request) {
  const auth = checkAuth(req);
  if (auth) return auth;
  return NextResponse.json(
    { ok: true, server: 'reach', time: new Date().toISOString() },
    { headers: cors() },
  );
}
