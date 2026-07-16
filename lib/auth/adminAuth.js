// 管理者パスワードの検証（ADMIN_PASSWORD環境変数と比較、タイミング攻撃対策あり）
import crypto from 'crypto';

export function isAdminAuthorized(req) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) return false;
  const provided = String(req.headers['x-admin-password'] || '');
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
