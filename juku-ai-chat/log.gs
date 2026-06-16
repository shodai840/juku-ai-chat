// log.gs — Google Apps Script
// Vercel(/api/chat)からPOSTを受けてスプレッドシートに1行追記する

// =====================================================
// 【使い方】
// 1. Google スプレッドシートを新規作成し「質問ログ」と名前をつける
// 2. 1行目にヘッダーを入力（A列〜H列）:
//    日時 | 生徒名 | 質問 | 画像 | AI回答 | 入力Token | 出力Token | 合計Token
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
  try {
    const data = JSON.parse(e.postData.contents);

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                  || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // 1行目がヘッダーでなければ自動追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['日時', '生徒名', '質問', '画像', 'AI回答', '入力Token', '出力Token', '合計Token']);
    }

    sheet.appendRow([
      data.timestamp            || '',
      data.studentName          || '',
      data.message              || '',
      data.hasImage             || 'なし',
      data.reply                || '',
      data.promptTokenCount     || 0,
      data.candidatesTokenCount || 0,
      data.totalTokenCount      || 0
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost error:', err);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// テスト用（Apps Scriptエディタから手動実行できる）
function testLog() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        timestamp: '2026-06-16 12:00',
        studentName: 'テスト太郎',
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
