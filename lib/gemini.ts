import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

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

// Gemini's structured output: this schema guarantees valid JSON shape on every response.
const responseSchema = {
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
    required: [
      'thread_id',
      'category',
      'summary',
      'suggested_reply',
      'urgency',
      'worth_replying',
    ],
    propertyOrdering: [
      'thread_id',
      'category',
      'summary',
      'suggested_reply',
      'urgency',
      'worth_replying',
    ],
  },
};

export async function classifyBatch(
  threads: ThreadForClassify[],
): Promise<Classification[]> {
  if (threads.length === 0) return [];
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const prompt = `You are triaging LinkedIn DMs for a busy professional. For each thread below, output one analysis object.

Fields to fill in:
- thread_id: copy exactly from input
- category: one of ${CATEGORIES.map(c => `"${c}"`).join(' | ')}
- summary: one neutral sentence (max 25 words) describing what the sender wants
- suggested_reply: a concise warm professional reply matching the sender's tone (max 60 words). For mass-outreach spam or messages that don't merit a reply, return ""
- urgency: low | medium | high — how time-sensitive is responding
- worth_replying: true | false — is a human reply worth the recipient's time

Threads:
${JSON.stringify(threads, null, 2)}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema as any,
      // Keep output focused; turn off thinking budget for speed/cost on this routine task.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text) throw new Error('Empty Gemini response');

  try {
    return JSON.parse(text) as Classification[];
  } catch (err) {
    // Schema-mode should make this impossible, but be defensive.
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('Gemini returned non-JSON: ' + text.slice(0, 200));
    return JSON.parse(text.slice(start, end + 1)) as Classification[];
  }
}
