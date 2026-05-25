import { createAdminClient } from '@/lib/supabase/server';
import { embed } from '@/lib/gemini';

export async function retrieveStyleSamples(
  contextText: string,
  topK: number = 5,
): Promise<string[]> {
  const admin = createAdminClient();
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(contextText);
  } catch {
    // No embedding available — fall back to recent samples
    const { data } = await admin
      .from('style_corpus')
      .select('text')
      .order('created_at', { ascending: false })
      .limit(topK);
    return (data || []).map(r => r.text);
  }

  // pgvector cosine-distance via RPC. Inline SQL via .rpc would require
  // declaring a function; use the simpler "order by embedding <=> '...'" string.
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const { data, error } = await admin
    .rpc('match_style_corpus', { query_embedding: embeddingStr, match_count: topK });

  if (error || !data) {
    // RPC missing or failed — fall back
    const { data: fallback } = await admin
      .from('style_corpus')
      .select('text')
      .order('created_at', { ascending: false })
      .limit(topK);
    return (fallback || []).map(r => r.text);
  }
  return (data as { text: string }[]).map(r => r.text);
}

export async function getStyleBrief(): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin.from('style_brief').select('content').eq('id', 1).single();
  return data?.content || '';
}
