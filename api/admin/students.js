
// api/admin/students.js — Vercel Serverless Function
// 管理者用：生徒の一覧取得・承認・却下・削除（ADMIN_PASSWORDで保護、管理者は一人の想定）
import crypto from 'crypto';
import { listStudents, updateStudentsStatus, deleteStudents } from '../../lib/supabase.js';

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

function isAdminAuthorized(req) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const provided = String(req.headers['x-admin-password'] || '');
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
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
      const students = await listStudents();
      return res.status(200).json({ students });
    } catch (err) {
      console.error('生徒一覧取得エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが起きました' });
    }
  }

  if (req.method === 'POST') {
    const { action, ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'idsが必要です' });
    }
    try {
      if (action === 'approve') {
        await updateStudentsStatus(ids, 'approved');
      } else if (action === 'reject') {
        await updateStudentsStatus(ids, 'rejected');
      } else if (action === 'delete') {
        await deleteStudents(ids);
      } else {
        return res.status(400).json({ error: 'actionが不正です' });
      }
      return res.status(200).json({ status: 'ok' });
    } catch (err) {
      console.error('管理者操作エラー:', err);
      return res.status(500).json({ error: 'サーバーエラーが起きました' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
