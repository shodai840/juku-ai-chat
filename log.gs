// log.gs — Google Apps Script
// Vercel(/api/chat)からPOSTを受けてスプレッドシートに1行追記する

// =====================================================
// 【使い方】
// 1. Google スプレッドシートを新規作成し「質問ログ」と名前をつける
// 2. 1行目にヘッダーを入力（A列〜K列）:
//    日時 | 学年 | クラス | 生徒名 | 質問 | 画像 | AI回答 | 入力Token | 出力Token | 合計Token | 本日の累計Token
//    ※既存シートの列順が違う場合は、Google Sheets上で列を手動で並び替えてから使うこと
//      （このコードは常にA〜K列をこの順で扱うため、ズレたままだと違う列にデータが入る）
//    ※「本日の累計Token」は生徒ごとではなく、サイト全体（全生徒合計）のその日のトークン合計
//    ※フィードバック（👍/👎）用の「フィードバック」シートは、初回送信時に自動で作成されるので手動作成は不要
// 3. スプレッドシートのメニュー → 拡張機能 → Apps Script
// 4. このコードを貼り付けて保存（Ctrl+S）
// 5. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
//    - 説明: 質問ログ受信
//    - 次のユーザーとして実行: 自分
//    - アクセスできるユーザー: 全員
// 6. 「デプロイ」ボタン → URLをコピー（= LOG_WEBHOOK_URL）
// =====================================================

const SHEET_NAME = 'Sheet1'; // シート名（変更した場合は合わせる）
const FEEDBACK_SHEET_NAME = 'フィードバック'; // 生徒の👍👎を記録する専用シート（無ければ自動作成）
const WEEKLY_SHEET_NAME = '週次利用状況'; // 生徒ごとの週次利用状況を自動記録するシート（無ければ自動作成）

// ── 共有シークレット（任意）──
// このWebアプリのURLを知っていれば誰でもPOSTできてしまう問題への対処。
// 「プロジェクトの設定」→「スクリプト プロパティ」に LOG_SHARED_SECRET を追加すると、
// 一致しないPOSTを拒否するようになる（未設定の間は今まで通り誰からでも受け付ける＝後方互換）。
// これによりVercel側（api/chat.js等）が先にシークレットを送るようになってから、
// こちらのプロパティを設定するだけで有効化でき、コードの再デプロイなしで切り替えられる。
function getRequiredSecret() {
  return PropertiesService.getScriptProperties().getProperty('LOG_SHARED_SECRET') || '';
}

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

    const requiredSecret = getRequiredSecret();
    if (requiredSecret && data.secret !== requiredSecret) {
      console.error('doPost: シークレット不一致のため拒否');
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.type === 'feedback') {
      return handleFeedback(data);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                  || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // 1行目がヘッダーでなければ自動追加
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['日時', '学年', 'クラス', '生徒名', '質問', '画像', 'AI回答', '入力Token', '出力Token', '合計Token', '本日の累計Token']);
    }

    sheet.appendRow([
      data.timestamp            || '',
      data.studentGrade         || '',
      data.studentClass         || '',
      data.studentName          || '',
      data.message              || '',
      data.hasImage             || 'なし',
      data.reply                || '',
      data.promptTokenCount     || 0,
      data.candidatesTokenCount || 0,
      data.totalTokenCount      || 0,
      '' // 本日の累計Token（この後 updateDailyCumulative() が書き込む）
    ]);

    // 本日（サイト全体）の累計トークン数を計算し、K列に記録
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

// フィードバック（👍/👎）を専用シートに1行追記する（doPost内のロックの中から呼ばれる）
function handleFeedback(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FEEDBACK_SHEET_NAME)
                || SpreadsheetApp.getActiveSpreadsheet().insertSheet(FEEDBACK_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['日時', '学年', 'クラス', '生徒名', '評価', '科目', '生徒の質問', 'AI回答', '入力Token', '出力Token']);
  }

  sheet.appendRow([
    data.timestamp             || '',
    data.studentGrade          || '',
    data.studentClass          || '',
    data.studentName           || '',
    data.feedback              || '',
    data.subject                || '',
    data.questionText           || '',
    data.aiReply                 || '',
    data.promptTokenCount      || 0,
    data.candidatesTokenCount  || 0
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// 本日（サイト全体・全生徒合計）の累計トークン数を計算し、最終行のK列に書き込む
// 全行を読み直すのではなく、直前の行だけを見て前回の累計に今回分を足す（行数が増えても処理時間は一定）
function updateDailyCumulative() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // ヘッダーのみの場合は何もしない

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const thisRowTokens = Number(sheet.getRange(lastRow, 10).getValue()) || 0; // J列: 今回の合計Token

  let prevCumulative = 0;
  if (lastRow > 2) {
    const prevTimestamp = String(sheet.getRange(lastRow - 1, 1).getValue() || '');
    if (prevTimestamp.indexOf(todayStr) === 0) {
      prevCumulative = Number(sheet.getRange(lastRow - 1, 11).getValue()) || 0; // 直前行のK列（累計）
    }
    // 直前行が今日でなければ（日をまたいだ）、今回分だけからスタート
  }

  sheet.getRange(lastRow, 11).setValue(prevCumulative + thisRowTokens); // K列（11列目）
}

// タイムスタンプ文字列（'yyyy-MM-dd HH:mm:ss'）の先頭から日付部分だけを取り出してDateにする。パースできなければnull
function parseLogDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

// 直前の月曜0:00〜今週月曜0:00の直前（＝先週1週間分）の生徒ごとの質問回数・合計Tokenを集計し、
// 「週次利用状況」シートの先頭（ヘッダーの直後）に追記する。誰がよく使っているかを把握する目的。
// 毎週月曜の朝に自動実行される想定（createWeeklyTrigger()で最初に1回だけ手動セットアップが必要）
function recordWeeklyUsage() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // ログがまだない

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=日, 1=月, ...6=土
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const weekStartStr = Utilities.formatDate(lastMonday, 'Asia/Tokyo', 'yyyy-MM-dd');

  // A列(日時)〜J列(合計Token)を読む
  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const usageByStudent = {}; // 生徒名 -> { count, tokens }

  data.forEach(row => {
    const rowDate = parseLogDate(row[0]);
    if (!rowDate || rowDate < lastMonday || rowDate >= thisMonday) return;
    const studentName = String(row[3] || '不明');
    const tokens = Number(row[9]) || 0;
    if (!usageByStudent[studentName]) usageByStudent[studentName] = { count: 0, tokens: 0 };
    usageByStudent[studentName].count += 1;
    usageByStudent[studentName].tokens += tokens;
  });

  const rows = Object.keys(usageByStudent)
    .map(name => [weekStartStr, name, usageByStudent[name].count, usageByStudent[name].tokens])
    .sort((a, b) => b[2] - a[2]); // 質問回数の多い順

  if (rows.length === 0) return; // その週の利用者がいなければ何も書かない

  const weeklySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WEEKLY_SHEET_NAME)
                       || SpreadsheetApp.getActiveSpreadsheet().insertSheet(WEEKLY_SHEET_NAME);
  if (weeklySheet.getLastRow() === 0) {
    weeklySheet.appendRow(['週開始日（月）', '生徒名', '質問回数', '合計Token']);
  }
  // 新しい週を一番上（ヘッダーの直後）に挿入し、古い週は下に押し出す
  weeklySheet.insertRowsAfter(1, rows.length);
  weeklySheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

// 【初回のみ手動実行】毎週月曜の朝に recordWeeklyUsage() を自動実行するトリガーを設定する。
// Apps Scriptエディタで上部の対象関数を「createWeeklyTrigger」に選んでから「実行」ボタンを押してください
// （初回は権限の承認が求められます）。すでに同名のトリガーがあれば一度削除してから作り直すので、
// 設定をやり直したいときも同じ関数を実行するだけでOK。
function createWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'recordWeeklyUsage') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recordWeeklyUsage')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(6)
    .create();
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
