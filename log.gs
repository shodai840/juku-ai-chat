// log.gs — Google Apps Script
// Vercel(/api/chat)からPOSTを受けてスプレッドシートに1行追記する

// =====================================================
// 【使い方】
// 1. Google スプレッドシートを新規作成し「質問ログ」と名前をつける
// 2. 1行目にヘッダーを入力（A列〜K列）:
//    日時 | 生徒名 | 質問 | 画像 | AI回答 | 入力Token | 出力Token | 合計Token | 本日の累計Token | 学年 | クラス
//    ※すでにI列「学年」・J列「クラス」まで使っている場合は要注意：
//      I列の左に列を1本「挿入」して「本日の累計Token」にし、既存の学年・クラスをJ・K列にずらす。
//      （末尾にK列を追加するだけだと、既存の学年・クラス列とデータがずれるので注意）
//    ※「本日の累計Token」は生徒ごとではなく、サイト全体（全生徒合計）のその日のトークン合計
// 3. スプレッドシートのメニュー → 拡張機能 → Apps Script
// 4. このコードを貼り付けて保存（Ctrl+S）
// 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
//    - 説明: 質問ログ受信
//    - 次のユーザーとして実行: 自分
//    - アクセスできるユーザー: 全員
// 6. 「デプロイ」ボタン → URLをコピー（= LOG_WEBHOOK_URL）
// =====================================================

const SHEET_NAME = 'Sheet1'; // シート名（変更した場合は合わせる）

function doPost(e) {
  // 生徒が同時に質問した場合、appendRowとupdateDailyCumulative()の間に
  // 別のリクエストが割り込むと行がズレる（累計を違う行に書いてしまう）ことがあるため、
  // この一連の処理が同時に1件しか実行されないようロックする。
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 最大10秒待つ
  } catch (err) {
    console.error('doPost lock timeout:', err);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'サーバーが混み合っています（ロック取得失敗）' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const data = JSON.parse(e.postData.contents);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                  || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // 1行目がヘッダーでなければ自動追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['日時', '生徒名', '質問', '画像', 'AI回答', '入力Token', '出力Token', '合計Token', '本日の累計Token', '学年', 'クラス']);
    }

    sheet.appendRow([
      data.timestamp            || '',
      data.studentName          || '',
      data.message              || '',
      data.hasImage             || 'なし',
      data.reply                || '',
      data.promptTokenCount     || 0,
      data.candidatesTokenCount || 0,
      data.totalTokenCount      || 0,
      '', // 本日の累計Token（この後 updateDailyCumulative() が書き込む）
      data.studentGrade         || '',
      data.studentClass         || ''
    ]);

    // 本日（サイト全体）の累計トークン数を計算し、I列に記録
    updateDailyCumulative();

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost error:', err);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// 本日（サイト全体・全生徒合計）の累計トークン数を計算し、最終行のI列に書き込む
// 全行を読み直すのではなく、直前の行だけを見て前回の累計に今回分を足す（行数が増えても処理時間は一定）
function updateDailyCumulative() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // ヘッダーのみの場合は何もしない

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const thisRowTokens = Number(sheet.getRange(lastRow, 8).getValue()) || 0; // H列: 今回の合計Token

  let prevCumulative = 0;
  if (lastRow > 2) {
    const prevTimestamp = String(sheet.getRange(lastRow - 1, 1).getValue() || '');
    if (prevTimestamp.indexOf(todayStr) === 0) {
      prevCumulative = Number(sheet.getRange(lastRow - 1, 9).getValue()) || 0; // 直前行のI列（累計）
    }
    // 直前行が今日でなければ（日をまたいだ）、今回分だけからスタート
  }

  sheet.getRange(lastRow, 9).setValue(prevCumulative + thisRowTokens); // I列（9列目）
}

// テスト用（Apps Scriptエディタから手動実行できる）
function testLog() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        timestamp: '2026-06-16 12:00',
        studentName: 'テスト太郎',
        studentGrade: '中3',
        studentClass: 'S（御三家志望）',
        message: '二次方程式の解き方を教えて',
        hasImage: 'なし',
        reply: 'まず因数分解を試してみよう！',
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150
      })
    }
  };
  const result = doPost(testData);
  Logger.log(result.getContent());
}
