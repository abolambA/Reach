import { NextResponse } from 'next/server';
import { classifyBatch, type ThreadForClassify } from '@/lib/gemini';
import { retrieveStyleSamples, getStyleBrief } from '@/lib/rag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Accepts a pasted message OR a pasted conversation and returns a classification
// + drafted reply in the user's voice. No DB write — this is a stateless helper
// so the user can triage anything they paste in without it polluting the graph.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      mode, // 'single' | 'conversation'
      sender, // optional sender name
      text, // the pasted content
    } = body as { mode?: string; sender?: string; text?: string };

    if (!text || text.trim().length < 2) {
      return NextResponse.json({ error: 'Paste a message first.' }, { status: 400 });
    }

    // Build a pseudo-thread for the classifier.
    // For 'conversation' mode the text already contains multiple turns; we pass it whole.
    // For 'single' mode we wrap it as one inbound message.
    const excerpt =
      mode === 'conversation'
        ? text.trim().slice(0, 4000)
        : `[${sender || 'them'}]: ${text.trim().slice(0, 2000)}`;

    const forClassify: ThreadForClassify[] = [
      {
        thread_id: 'paste',
        from: sender || 'Unknown sender',
        title: sender || 'Pasted message',
        excerpt,
      },
    ];

    // Pull the user's writing style so the draft sounds like them
    let styleContext = '';
    try {
      const brief = await getStyleBrief();
      const samples = await retrieveStyleSamples(text, 5);
      const sampleBlock = samples.length
        ? samples.map((s, i) => `Sample ${i + 1}: ${s}`).join('\n')
        : '';
      styleContext = [brief, sampleBlock].filter(Boolean).join('\n\n');
    } catch {
      // Style corpus not available — proceed without it
    }

    const results = await classifyBatch(forClassify, styleContext || undefined);
    const result = results[0];
    if (!result) {
      return NextResponse.json({ error: 'Could not classify.' }, { status: 500 });
    }

    return NextResponse.json({
      category: result.category,
      summary: result.summary,
      suggested_reply: result.suggested_reply,
      urgency: result.urgency,
      worth_replying: result.worth_replying,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed' }, { status: 500 });
  }
}
