import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

// ============================================================
// CLASSIFICATION (extends the v1 inbox triage)
// ============================================================

export type ThreadForClassify = {
  thread_id: string;
  from: string;
  title: string;
  excerpt: string;
};

export type Classification = {
  thread_id: string;
  category: string;
  summary: string;
  suggested_reply: string;
  urgency: 'low' | 'medium' | 'high';
  worth_replying: boolean;
};

const CATEGORIES = [
  'Sales Pitch',
  'Recruiter',
  'Job Inquiry',
  'Networking',
  'Real Question',
  'Personal',
  'Spam/Bot',
  'Other',
] as const;

const classifySchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      thread_id: { type: 'string' },
      category: { type: 'string', enum: [...CATEGORIES] },
      summary: { type: 'string' },
      suggested_reply: { type: 'string' },
      urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
      worth_replying: { type: 'boolean' },
    },
    required: ['thread_id','category','summary','suggested_reply','urgency','worth_replying'],
    propertyOrdering: ['thread_id','category','summary','suggested_reply','urgency','worth_replying'],
  },
};

export async function classifyBatch(
  threads: ThreadForClassify[],
  styleContext?: string,
): Promise<Classification[]> {
  if (threads.length === 0) return [];
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const styleBlock = styleContext
    ? `\n\nWrite suggested_reply in the user's own voice. Here are samples of how they actually write:\n${styleContext}\n`
    : '';

  const prompt = `You are triaging LinkedIn DMs for a busy professional. For each thread, output one analysis object.

Fields:
- thread_id: copy from input
- category: one of ${CATEGORIES.map(c => `"${c}"`).join(' | ')}
- summary: one neutral sentence (max 25 words)
- suggested_reply: warm professional reply matching the sender's tone (max 60 words). Empty string "" for spam.
- urgency: low | medium | high
- worth_replying: true | false${styleBlock}

Threads:
${JSON.stringify(threads, null, 2)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: classifySchema as any,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text) throw new Error('Empty Gemini response');
  try {
    return JSON.parse(text) as Classification[];
  } catch {
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    return JSON.parse(text.slice(s, e + 1)) as Classification[];
  }
}

// ============================================================
// EMBEDDINGS — for RAG over the user's writing
// ============================================================

export async function embed(text: string): Promise<number[]> {
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const trimmed = text.slice(0, 4000); // be safe with input length
  const res = await ai.models.embedContent({
    model: 'text-embedding-004',
    contents: trimmed,
    config: { outputDimensionality: 768 },
  });
  const values = (res as any).embeddings?.[0]?.values || (res as any).embedding?.values;
  if (!values) throw new Error('No embedding in response');
  return values;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Gemini doesn't have a true batch endpoint; do them concurrently with mild fan-out.
  const out: number[][] = [];
  const BATCH = 8;
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(t => embed(t)));
    out.push(...results);
  }
  return out;
}

// ============================================================
// OUTREACH DRAFTING — persona-aware, goal-aware
// ============================================================

export type OutreachContext = {
  target_name: string;
  target_headline?: string;
  target_company?: string;
  goal_label?: string;
  via_name?: string;                  // mutual we're going through
  style_samples: string[];            // top-k retrieved from style_corpus
  style_brief?: string;
  kind: 'outreach' | 'intro_request' | 'comment' | 'reply';
  post_content?: string;              // if commenting on a post
  original_message?: string;          // if replying
};

export async function draftMessage(ctx: OutreachContext): Promise<string> {
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const samples = ctx.style_samples.length
    ? `\n\nHere are samples of how you actually write — match this voice exactly:\n${ctx.style_samples.map((s, i) => `[Sample ${i + 1}]\n${s}`).join('\n\n')}\n`
    : '';

  const brief = ctx.style_brief?.trim()
    ? `\n\nYour style brief: ${ctx.style_brief}\n`
    : '';

  let task: string;
  switch (ctx.kind) {
    case 'outreach':
      task = `Write a short cold-outreach LinkedIn message to ${ctx.target_name}${ctx.target_headline ? ` (${ctx.target_headline})` : ''}${ctx.target_company ? ` at ${ctx.target_company}` : ''}.`;
      if (ctx.goal_label) task += ` Your goal context: "${ctx.goal_label}".`;
      task += ' Keep it under 50 words. No "Hope this finds you well." Mention one specific reason you reached out.';
      break;
    case 'intro_request':
      task = `Write a short message to ${ctx.via_name}, asking for an introduction to ${ctx.target_name}${ctx.target_headline ? ` (${ctx.target_headline})` : ''}. Be specific about why. Under 60 words. Warm but direct — this is someone you already know.`;
      break;
    case 'comment':
      task = `Write a thoughtful comment on this LinkedIn post by ${ctx.target_name}:\n\n"${ctx.post_content || ''}"\n\nAdd genuine value or a substantive question. NOT generic praise. Under 35 words.`;
      break;
    case 'reply':
      task = `Write a reply to this LinkedIn DM:\n\n"${ctx.original_message || ''}"\n\nFrom ${ctx.target_name}. Under 60 words.`;
      break;
  }

  const prompt = `${task}${samples}${brief}\n\nReturn ONLY the message text. No prefix, no quotes, no explanation.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  return (response.text || '').trim();
}

// ============================================================
// DYNAMIC LABELING (no fixed taxonomy)
// ============================================================

export async function dynamicCategorize(content: string, knownCategories: string[]): Promise<string[]> {
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const prompt = `Pick 1-3 short labels (1-3 words each) for this LinkedIn message content. Prefer reusing existing labels when they fit. Only invent a new label if no existing one is appropriate.

Existing labels: ${knownCategories.length ? knownCategories.join(', ') : '(none yet)'}

Content:
${content.slice(0, 2000)}

Return ONLY a JSON array of strings. No prose, no fences.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: { type: 'array', items: { type: 'string' } } as any,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  try {
    return JSON.parse(response.text || '[]');
  } catch {
    return [];
  }
}
