import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

export async function GET() {
  const admin = createAdminClient();
  const { count } = await admin.from('style_corpus').select('*', { count: 'exact', head: true });
  return NextResponse.json({ count: count || 0 });
}
