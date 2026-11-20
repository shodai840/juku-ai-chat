// api/keepalive.js — Vercel Cron（vercel.jsonのcrons）から1日1回呼ばれる
// Supabase無料プランは1週間アクセスが無いと自動で一時停止（Paused）し、質問AI・ログイン・管理画面が
// すべて使えなくなる。それを防ぐために毎日軽くDBを読む。失敗したら管理者（LINE_ADMIN_USER_ID）にLINEで知らせる。
// Vercel Cronは「Authorization: Bearer <CRON_SECRET>」を付けて呼ぶので、それ以外のアクセスは拒否する
// （誰でも叩けると、失敗時のLINE通知を悪用される可能性があるため）。
import crypto from 'crypto';
import { pingDatabase } from '../lib/supabase.js';
import { sendLineNotification } from '../lib/line.js';

function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = Buffer.from(String(req.headers['authorization'] || ''));
  const expected = Buffer.from(`Bearer ${secret}`);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET が設定されていません（Vercelの環境変数に追加してください）');
    return res.status(500).json({ error: 'CRON_SECRET未設定' });
  }
  if (!isCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await pingDatabase();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('keepalive: Supabaseへの接続失敗:', err);
    await sendLineNotification(
      '【質問AI】Supabaseに接続できませんでした。\n' +
      '一時停止（Paused）していると、生徒の質問・ログイン・管理画面が使えません。\n' +
      'Supabaseのダッシュボードを確認し、Pausedなら「Restore project」を押してください。\n' +
      `エラー: ${err.message}`
    );
    return res.status(500).json({ ok: false });
  }
}
