
// api/admin/settings.js — Vercel Serverless Function
// 管理者用：アプリ設定の取得・更新（LINE通知のオン/オフはADMIN_PASSWORDで、
// 自動承認モードはMASTER_ADMIN_PASSWORDでのみ変更可能）
import { getSettings, updateSettings } from '../../lib/supabase.js';
import { isAdminAuthorized, getAdminLevel } from '../../lib/auth/adminAuth.js';

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
      return res.status(200).json({ settings, adminLevel: getAdminLevel(req) });
    } catch (err) {
      console.error('設定取得エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが起きました' });
    }
  }

  if (req.method === 'POST') {
    const { lineNotifyEnabled, autoApproveEnabled } = req.body || {};
    const patch = {};
    if (typeof lineNotifyEnabled === 'boolean') {
      patch.line_notify_enabled = lineNotifyEnabled;
    }
    if (typeof autoApproveEnabled === 'boolean') {
      if (getAdminLevel(req) !== 'master') {
        return res.status(403).json({ error: 'この操作にはマスター権限が必要です' });
      }
      patch.auto_approve_enabled = autoApproveEnabled;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: '更新内容がありません' });
    }
    try {
      await updateSettings(patch);
      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('設定更新エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが起きました' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
