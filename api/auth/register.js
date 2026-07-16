
// api/auth/register.js — Vercel Serverless Function
// 生徒の新規登録（pending状態で作成し、管理者にLINE通知）
import { waitUntil } from '@vercel/functions';
import { normalizeName } from '../../lib/auth/normalizeName.js';
import { hashPassword } from '../../lib/auth/crypto.js';
import { findStudentByNormalizedName, insertStudent } from '../../lib/supabase.js';
import { sendLineNotification } from '../../lib/line.js';

// ── 同一IPからの連続登録試行の制限（乱用防止：1分あたり5回まで）──
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;
const requestLog = new Map(); // ip -> リクエスト時刻の配列
function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://juku-ai-chat.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, password } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '名前を入力してね' });
  }
  if (name.length > 50) {
    return res.status(400).json({ error: '名前が長すぎるみたい' });
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'パスワードは4文字以上で決めてね' });
  }
  if (password.length > 100) {
    return res.status(400).json({ error: 'パスワードが長すぎるみたい' });
  }

  const clientIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: '⏳ 少し試しすぎみたい。少し待ってからもう一度試してね。' });
  }

  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    return res.status(400).json({ error: '名前を正しく入力してね' });
  }

  let existing;
  try {
    existing = await findStudentByNormalizedName(normalizedName);
  } catch (err) {
    console.error('登録時の重複チェックエラー:', err);
    return res.status(500).json({ error: 'サーバーエラーが起きました。しばらくしてからもう一度試してね。' });
  }
  if (existing) {
    return res.status(409).json({ error: 'その名前はすでに登録されています。ログインしてね。' });
  }

  const passwordHash = hashPassword(password);
  let student;
  try {
    student = await insertStudent({ name: name.trim(), normalizedName, passwordHash });
  } catch (err) {
    console.error('登録エラー:', err);
    return res.status(500).json({ error: 'サーバーエラーが起きました。しばらくしてからもう一度試してね。' });
  }

  waitUntil(sendLineNotification(
    `【生徒登録申請】\n名前：${student.name}\n管理画面から承認してください。`
  ));

  return res.status(200).json({
    status: 'pending',
    message: '登録を受け付けました。先生の承認をお待ちください。'
  });
}
