// リクエストのJWTを検証し、DBの承認状態も毎回再確認する（承認取り消しを即時反映させるため）
import { verifyToken } from './jwt.js';
import { findStudentById } from '../supabase.js';

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
    return null;
  }
  if (!student || student.status !== 'approved') return null;

  return { id: student.id, name: student.name };
}
