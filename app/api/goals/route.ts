import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('goals')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ goals: data || [] });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { label, kind, criteria, target_value, notes } = body;
    if (!label || !kind) {
      return NextResponse.json({ error: 'missing label or kind' }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('goals')
      .insert({
        label,
        kind,
        criteria: criteria || {},
        target_value: target_value || null,
        notes: notes || null,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ goal: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
