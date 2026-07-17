
// api/auth/login.js — Vercel Serverless Function
// 生徒のログイン（承認済みのみ許可）。成功時にJWTを発行する
import { normalizeName } from '../../lib/auth/normalizeName.js';
import { hashPassword, verifyPassword } from '../../lib/auth/crypto.js';
import { findStudentByNormalizedName } from '../../lib/supabase.js';
import { signToken } from '../../lib/auth/jwt.js';

// ── 同一名前への連続ログイン試行の制限（総当たり対策：5分あたり10回まで）──
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const attemptLog = new Map(); // normalizedName -> リクエスト時刻の配列
function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (attemptLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  attemptLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// 名前が存在しない場合でも応答時間を揃えるためのダミーハッシュ（ユーザー列挙対策）
const DUMMY_HASH = hashPassword('dummy-password-for-timing-safety');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://minato-ai-chat.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, password } = req.body || {};
  if (!name || typeof name !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: '名前とパスワードを入力してね' });
  }

  const normalizedName = normalizeName(name);
  if (isRateLimited(normalizedName)) {
    return res.status(429).json({ error: '⏳ 少し試しすぎみたい。少し待ってからもう一度試してね。' });
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーです。管理者に連絡してください。' });
  }

  let student;
  try {
    student = await findStudentByNormalizedName(normalizedName);
  } catch (err) {
    console.error('ログイン時の検索エラー:', err);
    return res.status(500).json({ error: 'サーバーエラーが起きました。しばらくしてからもう一度試してね。' });
  }

  const passwordOk = verifyPassword(password, student ? student.password_hash : DUMMY_HASH);
  if (!student || !passwordOk) {
    return res.status(401).json({ error: '名前かパスワードが違うみたい' });
  }

  if (student.status === 'pending') {
    return res.status(403).json({ error: 'まだ先生の承認待ちです。承認されるまでお待ちね。' });
  }
  if (student.status !== 'approved') {
    return res.status(403).json({ error: 'ログインできませんでした。先生に確認してね。' });
  }

  const token = signToken({ sub: student.id, name: student.name }, JWT_SECRET);
  return res.status(200).json({ token, name: student.name });
}
