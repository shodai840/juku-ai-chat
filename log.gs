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

const SHEET_NAME = 'シート1'; // シート名（実際のタブ名に合わせる。以前は'Sheet1'と誤って設定されておりgetActiveSheet()のフォールバックで動いていたため、createLogViews()等アクティブなシートに依存する処理で誤動作の原因になっていた）
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
      sheet.appendRow(['日時', '学年', 'クラス', '生徒名', '質問', '画像', 'AI回答', '入力Token', '出力Token', '合計Token', '本日の累計Token', '使用モデル']);
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
      '', // 本日の累計Token（この後 updateDailyCumulative() が書き込む）
      data.model                || '' // L列: 実際に使用したGeminiのモデル名（料金計算で使う）
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

// A列(日時)のセルの値を'yyyy-MM-dd'の文字列にする。
// Googleスプレッドシートは「2026-07-17 22:51:10」のような文字列を自動的に日付型に
// 変換してしまうことがあり、その場合getValue()は文字列ではなくDateオブジェクトを返す。
// 単純な文字列前方一致judgementだとDateオブジェクトのtoString()（例："Fri Jul 17..."）とは
// 一致しないため、型に応じて処理を分ける。
function cellValueToDateStr(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(value || '').slice(0, 10);
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
    const prevTimestampValue = sheet.getRange(lastRow - 1, 1).getValue();
    if (cellValueToDateStr(prevTimestampValue) === todayStr) {
      prevCumulative = Number(sheet.getRange(lastRow - 1, 11).getValue()) || 0; // 直前行のK列（累計）
    }
    // 直前行が今日でなければ（日をまたいだ）、今回分だけからスタート
  }

  sheet.getRange(lastRow, 11).setValue(prevCumulative + thisRowTokens); // K列（11列目）
}

// 【一度だけ手動実行】既存の全行のK列（本日の累計Token）を、日付ごとに正しく積算し直す。
// 日付列の自動型変換バグ（cellValueToDateStr参照）により、過去の行の累計が正しく
// 計算されていなかった分を修正するためのもの。K列以外は一切変更しない。何度実行しても
// 結果は同じになるので安全。行は元々の並び順（appendRowによる時系列順）を前提にしている。
function recalculateAllDailyCumulative() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return; // ヘッダーのみの場合は何もしない

  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues(); // A〜J列
  const kValues = [];
  let currentDateStr = null;
  let cumulative = 0;

  data.forEach(row => {
    const dateStr = cellValueToDateStr(row[0]);
    const tokens = Number(row[9]) || 0; // J列: 合計Token
    if (dateStr !== currentDateStr) {
      currentDateStr = dateStr;
      cumulative = 0;
    }
    cumulative += tokens;
    kValues.push([cumulative]);
  });

  sheet.getRange(2, 11, kValues.length, 1).setValues(kValues); // K列に書き戻す
}

// A列(日時)のセルの値から日付部分だけを取り出してDateにする。パースできなければnull。
// セルがGoogleスプレッドシートによって自動的に日付型に変換されている場合（Dateオブジェクト）と、
// 文字列のまま保持されている場合の両方に対応する（cellValueToDateStr参照）。
function parseLogDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

// 今日を含む週の月曜0:00を求める
function getThisMonday(now) {
  const dayOfWeek = now.getDay(); // 0=日, 1=月, ...6=土
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
}

// [weekStart, weekStart+7日) の範囲で生徒ごとの質問回数・合計Tokenを集計し、
// 「週次利用状況」シートの先頭（ヘッダーの直後）に追記する（無ければ結果を返すだけで何も書かない）。
// 戻り値は書き込んだ行数（0なら対象期間の利用者なし）。
function aggregateUsageForWeek(weekStart) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
                || SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0; // ログがまだない

  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
  const weekStartStr = Utilities.formatDate(weekStart, 'Asia/Tokyo', 'yyyy-MM-dd');

  // A列(日時)〜J列(合計Token)を読む
  const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const usageByStudent = {}; // 生徒名 -> { count, tokens }

  data.forEach(row => {
    const rowDate = parseLogDate(row[0]);
    if (!rowDate || rowDate < weekStart || rowDate >= weekEnd) return;
    const studentName = String(row[3] || '不明');
    const tokens = Number(row[9]) || 0;
    if (!usageByStudent[studentName]) usageByStudent[studentName] = { count: 0, tokens: 0 };
    usageByStudent[studentName].count += 1;
    usageByStudent[studentName].tokens += tokens;
  });

  const rows = Object.keys(usageByStudent)
    .map(name => [weekStartStr, name, usageByStudent[name].count, usageByStudent[name].tokens])
    .sort((a, b) => b[2] - a[2]); // 質問回数の多い順

  if (rows.length === 0) return 0; // その週の利用者がいなければ何も書かない

  const weeklySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WEEKLY_SHEET_NAME)
                       || SpreadsheetApp.getActiveSpreadsheet().insertSheet(WEEKLY_SHEET_NAME);
  if (weeklySheet.getLastRow() === 0) {
    weeklySheet.appendRow(['週開始日（月）', '生徒名', '質問回数', '合計Token']);
  }
  // 新しい週を一番上（ヘッダーの直後）に挿入し、古い週は下に押し出す
  weeklySheet.insertRowsAfter(1, rows.length);
  weeklySheet.getRange(2, 1, rows.length, 4).setValues(rows);
  return rows.length;
}

// 直前の月曜0:00〜今週月曜0:00の直前（＝先週1週間分、すでに終わった週）を集計する。
// 誰がよく使っているかを把握する目的。毎週月曜の朝に自動実行される想定
// （createWeeklyTrigger()で最初に1回だけ手動セットアップが必要）。
function recordWeeklyUsage() {
  const thisMonday = getThisMonday(new Date());
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  aggregateUsageForWeek(lastMonday);
}

// 【手動実行用】今週分（月曜〜今日、まだ終わっていない進行中の週）を今すぐ集計したいときに使う。
// 通常は自動実行される recordWeeklyUsage()（先週の完了分）だけで十分だが、
// 導入直後などまだ「先週分」のデータが無く週次シートに何も出ないときの動作確認用。
// 週の途中で使うと「今週分」が確定前の状態で記録され、翌週以降さらに追記されるため重複行になる点に注意。
function previewCurrentWeekUsage() {
  const thisMonday = getThisMonday(new Date());
  const count = aggregateUsageForWeek(thisMonday);
  Logger.log(count > 0 ? `今週分を${count}件記録しました` : '今週分のログがまだありません');
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

// 【初回のみ手動実行】質問ログ・フィードバックの「新しい順」ビュー用シートを作成する。
// 元データ（Sheet1・フィードバック）の並び順や書き込み方法は一切変更しない。
// SORT関数で参照するだけの別シートなので、質問のたびに走る書き込み処理の速度には影響しない。
// 既に同名シートがあれば作り直すだけなので、再実行しても安全。
function createLogViews() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const logSheet = ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet();
  const logSheetName = logSheet.getName();
  const logView = ss.getSheetByName('質問ログ') || ss.insertSheet('質問ログ');
  logView.getRange('A1').setFormula(
    `={'${logSheetName}'!A1:K1;SORT('${logSheetName}'!A2:K,1,FALSE)}`
  );

  const feedbackSheet = ss.getSheetByName(FEEDBACK_SHEET_NAME);
  if (feedbackSheet) {
    const feedbackView = ss.getSheetByName('フィードバックログ') || ss.insertSheet('フィードバックログ');
    feedbackView.getRange('A1').setFormula(
      `={'${FEEDBACK_SHEET_NAME}'!A1:J1;SORT('${FEEDBACK_SHEET_NAME}'!A2:J,1,FALSE)}`
    );
  }
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
