import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { draftMessage } from '@/lib/gemini';
import { retrieveStyleSamples, getStyleBrief } from '@/lib/rag';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_ACTIONS_PER_GOAL = 5;
const MIN_PRIORITY_GAP = 5;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const goalId = body?.goal_id; // optional: plan just one goal

    const admin = createAdminClient();
    const { data: self } = await admin
      .from('people')
      .select('urn')
      .eq('is_self', true)
      .single();

    let q = admin.from('goals').select('*').eq('status', 'active');
    if (goalId) q = q.eq('id', goalId);
    const { data: goals } = await q;

    if (!goals || goals.length === 0) {
      return NextResponse.json({ ok: true, planned: 0, note: 'no active goals' });
    }

    const styleBrief = await getStyleBrief();
    let totalActions = 0;
    const perGoal: { goal_id: string; count: number }[] = [];

    for (const goal of goals) {
      const newCount = await planForGoal(goal, self?.urn, styleBrief);
      totalActions += newCount;
      perGoal.push({ goal_id: goal.id, count: newCount });
    }

    return NextResponse.json({ ok: true, planned: totalActions, per_goal: perGoal });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function planForGoal(goal: any, selfUrn: string | null | undefined, styleBrief: string): Promise<number> {
  const admin = createAdminClient();

  // Pull candidate people based on goal kind
  let candidates: any[] = [];
  if (goal.kind === 'role_target' || goal.kind === 'followers' || goal.kind === 'custom') {
    const keywords: string[] = goal.criteria?.role_keywords || [];
    const industry: string = goal.criteria?.industry || '';
    let q = admin
      .from('people')
      .select('urn, name, headline, company, is_first_degree')
      .eq('is_self', false)
      .limit(200);
    if (keywords.length > 0) {
      const orFilter = keywords.map(k => `headline.ilike.%${k}%`).join(',');
      q = q.or(orFilter);
    }
    if (industry) q = q.ilike('industry', `%${industry}%`);
    const { data } = await q;
    candidates = data || [];
  } else if (goal.kind === 'named_person') {
    const namedUrn = goal.criteria?.target_urn;
    if (namedUrn) {
      const { data } = await admin
        .from('people')
        .select('urn, name, headline, company, is_first_degree')
        .eq('urn', namedUrn);
      candidates = data || [];
    }
  }

  if (candidates.length === 0) return 0;

  // Skip anyone we already have a recent action for
  const { data: existingActions } = await admin
    .from('actions')
    .select('target_urn')
    .in('status', ['queued', 'approved', 'sent'])
    .in('target_urn', candidates.map(c => c.urn));
  const seen = new Set((existingActions || []).map(a => a.target_urn));
  let fresh = candidates.filter(c => !seen.has(c.urn));

  // Rank: 1st-degree first (those we can DM directly), then everyone else
  fresh.sort((a, b) => {
    if (a.is_first_degree !== b.is_first_degree) return a.is_first_degree ? -1 : 1;
    return 0;
  });
  fresh = fresh.slice(0, MAX_ACTIONS_PER_GOAL);

  let inserted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const candidate = fresh[i];
    let kind: 'outreach' | 'intro_request' = 'outreach';
    let via_urn: string | null = null;
    let via_name: string | null = null;

    if (!candidate.is_first_degree && selfUrn) {
      // Try to find a path; if it exists, use intro_request via 2nd node
      const { data: pathArr } = await admin.rpc('find_path', {
        start_urn: selfUrn,
        end_urn: candidate.urn,
        max_depth: 3,
      });
      if (pathArr && pathArr.length >= 3) {
        via_urn = pathArr[1]; // the bridge person
        kind = 'intro_request';
        const { data: viaPerson } = await admin
          .from('people')
          .select('name')
          .eq('urn', via_urn!)
          .single();
        via_name = viaPerson?.name || null;
      } else {
        // No path yet — still queue an outreach but flag rationale
        kind = 'outreach';
      }
    }

    // RAG retrieve style samples
    const ctxText = `Reaching out to ${candidate.name || 'someone'} (${candidate.headline || ''}) about: ${goal.label}`;
    const samples = await retrieveStyleSamples(ctxText, 4);

    const draft = await draftMessage({
      target_name: candidate.name || 'there',
      target_headline: candidate.headline || undefined,
      target_company: candidate.company || undefined,
      goal_label: goal.label,
      via_name: via_name || undefined,
      style_samples: samples,
      style_brief: styleBrief,
      kind,
    });

    const rationale = kind === 'intro_request'
      ? `Goal "${goal.label}": reach ${candidate.name} via ${via_name}`
      : `Goal "${goal.label}": direct outreach to ${candidate.name}`;

    await admin.from('actions').insert({
      goal_id: goal.id,
      kind,
      target_urn: candidate.urn,
      via_urn,
      draft,
      rationale,
      status: 'queued',
      priority: 70 - i * MIN_PRIORITY_GAP,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    });
    inserted++;
  }

  return inserted;
}
