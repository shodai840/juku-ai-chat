// 名前の重複判定用に正規化する（全角/半角スペース・その他空白を除去、全角英数記号は半角に統一）
export function normalizeName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, '')
    .trim();
}
