
// api/admin/weekly-usage.js — Vercel Serverless Function
// 管理者用：生徒ごとの週次利用状況（質問回数・合計Token）をlog.gs(Apps Script)経由で取得する
import { isAdminAuthorized } from '../../lib/auth/adminAuth.js';

// ── 管理者パスワードの連続試行制限（総当たり対策：5分あたり10回まで）──
// api/admin/students.jsと同じ考え方で、このエンドポイントも独立してレート制限する
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const attemptLog = new Map();
function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (attemptLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  attemptLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://minato-ai-chat.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: '⏳ 少し試しすぎです。少し待ってからもう一度試してください。' });
  }

  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: '管理者パスワードが違います' });
  }

  const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;
  if (!LOG_WEBHOOK_URL) {
    console.error('LOG_WEBHOOK_URL が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーです。管理者に連絡してください。' });
  }
  const LOG_SHARED_SECRET = process.env.LOG_SHARED_SECRET || '';

  try {
    const params = new URLSearchParams({ action: 'weeklyUsage', weeks: '2' });
    if (LOG_SHARED_SECRET) params.set('secret', LOG_SHARED_SECRET);
    const gasRes = await fetch(`${LOG_WEBHOOK_URL}?${params.toString()}`);
    const data = await gasRes.json().catch(() => ({}));
    if (data.status !== 'ok') {
      console.error('週次利用状況取得エラー(GAS):', data);
      return res.status(502).json({ error: '週次利用状況の取得に失敗しました。' });
    }
    return res.status(200).json({ weeks: data.weeks });
  } catch (err) {
    console.error('週次利用状況取得エラー:', err);
    return res.status(500).json({ error: '週次利用状況の取得に失敗しました。' });
  }
}
