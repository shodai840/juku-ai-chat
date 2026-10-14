// api/auth/link.js — Vercel Serverless Function
// 生徒用時間割アプリからの自動ログイン（アカウント連携）。
// 時間割GAS（質問AI.js）が、連携済みの生徒の名前を入れた短い期限（30分）のチケットを
// 共有の合言葉 LINK_SECRET で署名して渡してくる（HS256 JWT: { aud: 'ai-link', name, iat, exp }）。
// ここでチケットを確かめ、その名前の生徒（承認済み）として通常のログイントークンを発行する
import { verifyToken, signToken } from '../../lib/auth/jwt.js';
import { normalizeName } from '../../lib/auth/normalizeName.js';
import { findStudentByNormalizedName } from '../../lib/supabase.js';

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

  const LINK_SECRET = process.env.LINK_SECRET;
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!LINK_SECRET || !JWT_SECRET) {
    console.error('LINK_SECRET / JWT_SECRET が設定されていません');
    return res.status(500).json({ error: '時間割アプリからの自動ログインは準備中です。名前とパスワードでログインしてね。' });
  }

  const { ticket } = req.body || {};
  const payload = verifyToken(ticket, LINK_SECRET);
  // 期限の無いチケットは受け付けない（verifyToken は exp があるときだけ期限を見るため）
  if (!payload || payload.aud !== 'ai-link' || typeof payload.exp !== 'number' || !payload.name) {
    return res.status(401).json({ error: 'リンクの期限が切れたみたい。時間割アプリからもう一度開いてね。' });
  }

  let student;
  try {
    student = await findStudentByNormalizedName(normalizeName(payload.name));
  } catch (err) {
    console.error('連携ログイン時の検索エラー:', err);
    return res.status(500).json({ error: 'サーバーエラーが起きました。しばらくしてからもう一度試してね。' });
  }

  if (!student) {
    return res.status(404).json({ error: '質問AIのアカウントが見つかりませんでした。時間割アプリで連携し直してね。' });
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
