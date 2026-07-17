
// api/auth/register.js — Vercel Serverless Function
// 生徒の新規登録（通常はpending状態で作成し管理者にLINE通知。自動承認モード時はapproved状態で作成）
import { waitUntil } from '@vercel/functions';
import { normalizeName } from '../../lib/auth/normalizeName.js';
import { hashPassword } from '../../lib/auth/crypto.js';
import { findStudentByNormalizedName, insertStudent, getSettings } from '../../lib/supabase.js';
import { sendLineNotification } from '../../lib/line.js';
import { signToken } from '../../lib/auth/jwt.js';

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

  let settings;
  try {
    settings = await getSettings();
  } catch (err) {
    console.error('設定取得エラー（自動承認・LINE通知の判定、通常通り承認待ちで進める）:', err);
    settings = { line_notify_enabled: true, auto_approve_enabled: false };
  }
  const autoApprove = settings.auto_approve_enabled === true;
  const initialStatus = autoApprove ? 'approved' : 'pending';

  const passwordHash = hashPassword(password);
  let student;
  try {
    student = await insertStudent({ name: name.trim(), normalizedName, passwordHash, status: initialStatus });
  } catch (err) {
    console.error('登録エラー:', err);
    return res.status(500).json({ error: 'サーバーエラーが起きました。しばらくしてからもう一度試してね。' });
  }

  if (settings.line_notify_enabled !== false) {
    waitUntil(sendLineNotification(
      autoApprove
        ? `【生徒登録】\n名前：${student.name}\n自動承認モードのため、承認済みで登録されました。`
        : `【生徒登録申請】\n名前：${student.name}\n管理画面から承認してください。`
    ));
  }

  if (autoApprove) {
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      console.error('JWT_SECRET が設定されていません');
      return res.status(500).json({ error: 'サーバー設定エラーです。管理者に連絡してください。' });
    }
    const token = signToken({ sub: student.id, name: student.name }, JWT_SECRET);
    return res.status(200).json({
      status: 'approved',
      token,
      name: student.name,
      message: '登録が完了しました。すぐに始められるよ！'
    });
  }

  return res.status(200).json({
    status: 'pending',
    message: '登録を受け付けました。先生が承認するまで少し待ってから、ログインしてね。'
  });
}
