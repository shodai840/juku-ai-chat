// リクエストのJWTを検証し、DBの承認状態も毎回再確認する（承認取り消しを即時反映させるため）
import { verifyToken } from './jwt.js';
import { findStudentById } from '../supabase.js';

// DB（Supabase）に繋がらず承認状態を確認できなかったときのエラー。
// 「ログイン情報が不正」とは区別する（401にすると生徒側で強制ログアウト＋会話表示が消えてしまうため）
export class AuthUnavailableError extends Error {}

// 戻り値：認証OKなら { id, name }、トークン不正・未承認なら null。
// DB障害時は AuthUnavailableError を投げる
export async function verifyAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET が設定されていません');
    return null;
  }

  const payload = verifyToken(match[1], JWT_SECRET);
  if (!payload || !payload.sub) return null;

  let student;
  try {
    student = await findStudentById(payload.sub);
  } catch (err) {
    console.error('認証時の生徒情報取得エラー:', err);
    throw new AuthUnavailableError(err.message);
  }
  if (!student || student.status !== 'approved') return null;

  return { id: student.id, name: student.name };
}

// API側の共通処理：認証して、だめならレスポンス（401 / 503）まで返す。
// 戻り値が null のときは、呼び出し側はそのまま return すればよい
export async function requireStudent(req, res) {
  try {
    const student = await verifyAuth(req);
    if (!student) {
      res.status(401).json({ error: 'ログインが必要です。もう一度ログインしてね。' });
      return null;
    }
    return student;
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      res.status(503).json({ error: '⚠️ いまサーバーの調子が悪くて使えないみたい。少し時間をおいてから、もう一度試してね。' });
      return null;
    }
    throw err;
  }
}
