import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const admin = createAdminClient();
  const { data } = await admin.from('style_brief').select('content').eq('id', 1).single();
  return NextResponse.json({ content: data?.content || '' });
}

export async function PUT(req: Request) {
  const { content } = await req.json();
  const admin = createAdminClient();
  await admin
    .from('style_brief')
    .upsert({ id: 1, content: content || '', updated_at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
