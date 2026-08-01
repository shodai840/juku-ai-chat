
// api/history.js — Vercel Serverless Function
// ログイン中の生徒の会話履歴を取得する（ブラウザを閉じた後でも見返せるように）。
// 一度に全件は返さず、新しい順にlimit件ずつ取得する（?before=ISO日時 でそれより古い分を追加取得）。
import { verifyAuth } from '../lib/auth/verifyAuth.js';
import { getMessagesForStudent } from '../lib/supabase.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://minato-ai-chat.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const student = await verifyAuth(req);
  if (!student) {
    return res.status(401).json({ error: 'ログインが必要です。もう一度ログインしてね。' });
  }

  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : undefined;

  try {
    // limit+1件取得して、実際にlimitを超えて返ってきたら「まだ古いものが残っている」と判定する
    const rows = await getMessagesForStudent(student.id, { limit: limit + 1, before });
    const hasMore = rows.length > limit;
    const trimmed = rows.slice(0, limit);
    // DBは新しい順で返ってくるので、画面表示用に古い順へ並び替える
    const messages = trimmed.reverse().map(r => ({
      role: r.role,
      text: r.text,
      createdAt: r.created_at
    }));
    return res.status(200).json({ messages, hasMore });
  } catch (err) {
    console.error('会話履歴取得エラー:', err);
    return res.status(500).json({ error: '会話履歴の取得に失敗しました。' });
  }
}
