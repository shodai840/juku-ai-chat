// 管理者パスワードの検証（ADMIN_PASSWORD / MASTER_ADMIN_PASSWORDと比較、タイミング攻撃対策あり）
// マスターパスワードは通常の管理者権限も兼ねる（上位互換）
import crypto from 'crypto';

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function isMasterAuthorized(req) {
  const expected = process.env.MASTER_ADMIN_PASSWORD || '';
  const provided = String(req.headers['x-admin-password'] || '');
  return safeEqual(provided, expected);
}

export function isAdminAuthorized(req) {
  const expected = process.env.ADMIN_PASSWORD || '';
  const provided = String(req.headers['x-admin-password'] || '');
  return safeEqual(provided, expected) || isMasterAuthorized(req);
}

// 'master' | 'admin' | null
export function getAdminLevel(req) {
  if (isMasterAuthorized(req)) return 'master';
  if (isAdminAuthorized(req)) return 'admin';
  return null;
}
