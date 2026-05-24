import { NextResponse } from 'next/server';
import { unipileConfigured, createHostedAuthLink } from '@/lib/unipile';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ configured: unipileConfigured() });
}

export async function POST(req: Request) {
  try {
    if (!unipileConfigured()) {
      return NextResponse.json({ error: 'Unipile not configured' }, { status: 400 });
    }
    const { label } = await req.json();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const link = await createHostedAuthLink({
      name: label || 'LinkedIn',
      successRedirectUrl: `${siteUrl}/api/unipile/sync?label=${encodeURIComponent(label || 'LinkedIn')}`,
      failureRedirectUrl: `${siteUrl}/import?error=unipile_failed`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    return NextResponse.json({ url: link.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
