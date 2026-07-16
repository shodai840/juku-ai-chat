
// api/admin/settings.js — Vercel Serverless Function
// 管理者用：アプリ設定の取得・更新（現状はLINE通知のオン/オフのみ。ADMIN_PASSWORDで保護）
import { getSettings, updateSettings } from '../../lib/supabase.js';
import { isAdminAuthorized } from '../../lib/auth/adminAuth.js';

// ── 管理者パスワードの連続試行制限（総当たり対策：5分あたり10回まで）──
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const attemptLog = new Map(); // ip -> リクエスト時刻の配列
function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (attemptLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  attemptLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://juku-ai-chat.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const clientIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: '⏳ 少し試しすぎです。少し待ってからもう一度試してください。' });
  }

  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: '管理者パスワードが違います' });
  }

  if (req.method === 'GET') {
    try {
      const settings = await getSettings();
      return res.status(200).json({ settings });
    } catch (err) {
      console.error('設定取得エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが起きました' });
    }
  }

  if (req.method === 'POST') {
    const { lineNotifyEnabled } = req.body || {};
    if (typeof lineNotifyEnabled !== 'boolean') {
      return res.status(400).json({ error: 'lineNotifyEnabledが必要です' });
    }
    try {
      await updateSettings({ line_notify_enabled: lineNotifyEnabled });
      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('設定更新エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが起きました' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
