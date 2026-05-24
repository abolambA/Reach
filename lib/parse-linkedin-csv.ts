import Papa from 'papaparse';

export type ParsedThread = {
  external_id: string;
  title: string;
  participants: string[];
  messages: Array<{
    sender: string;
    sender_profile_url: string;
    content: string;
    subject: string;
    sent_at: string;
    direction: 'inbound' | 'outbound';
  }>;
  first_message_at: string;
  last_message_at: string;
  preview: string;
};

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (row[k]) return row[k];
  return '';
}

export function parseLinkedInCSV(csvText: string, ownerName?: string): ParsedThread[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  const threads = new Map<string, ParsedThread & { _participants: Set<string> }>();

  for (const row of parsed.data) {
    const convId = col(row, 'CONVERSATION ID', 'conversation_id', 'Conversation ID');
    const from = col(row, 'FROM', 'from', 'From');
    const senderUrl = col(row, 'SENDER PROFILE URL', 'sender_profile_url');
    const content = col(row, 'CONTENT', 'content', 'Content');
    const date = col(row, 'DATE', 'date', 'Date');
    const subject = col(row, 'SUBJECT', 'subject', 'Subject');
    const title = col(row, 'CONVERSATION TITLE', 'conversation_title', 'Conversation Title');
    const folder = col(row, 'FOLDER', 'folder', 'Folder') || 'INBOX';

    if (!convId || !content) continue;

    let t = threads.get(convId);
    if (!t) {
      t = {
        external_id: convId,
        title: title || subject || from || '(no title)',
        participants: [],
        _participants: new Set<string>(),
        messages: [],
        first_message_at: date,
        last_message_at: date,
        preview: '',
      };
      threads.set(convId, t);
    }

    const isOutbound = ownerName ? from.trim().toLowerCase() === ownerName.toLowerCase() : false;

    if (from.trim()) t._participants.add(from.trim());

    t.messages.push({
      sender: from,
      sender_profile_url: senderUrl,
      content,
      subject,
      sent_at: date,
      direction: isOutbound ? 'outbound' : 'inbound',
    });

    try {
      if (new Date(date) > new Date(t.last_message_at)) t.last_message_at = date;
      if (new Date(date) < new Date(t.first_message_at)) t.first_message_at = date;
    } catch { /* ignore bad dates */ }
  }

  return Array.from(threads.values())
    .map(t => {
      t.messages.sort((a, b) => +new Date(a.sent_at) - +new Date(b.sent_at));
      t.participants = Array.from(t._participants);
      t.preview = (t.messages[0]?.content || '').slice(0, 200);
      delete (t as any)._participants;
      return t;
    })
    .sort((a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at));
}
