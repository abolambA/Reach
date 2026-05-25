import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const allowed = ['label', 'status', 'criteria', 'target_value', 'current_value', 'notes'];
    const update: any = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];

    const admin = createAdminClient();
    const { error } = await admin.from('goals').update(update).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient();
  const { error } = await admin.from('goals').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
