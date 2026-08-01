// ── 定数 ──
const MAX_HISTORY = 14;
const MAX_IMAGE_PX = 1600;

// ── 状態 ──
const HISTORY_KEY = 'chatHistory';
let history = [];
let pendingImageBase64 = null;
let pendingImageMimeType = null;
let isSending = false;
let katexReady = false;
let oldestLoadedAt = null;   // サーバーから読み込んだ会話履歴のうち一番古いもののcreated_at（追加読み込み用のカーソル）
let hasMoreServerHistory = false; // まだサーバー側に古い履歴が残っているか
let isLoadingOlderHistory = false;

// ── KaTeX初期化 ──
function initKaTeX() {
  katexReady = true;
  document.querySelectorAll('.model-bubble').forEach(renderKaTeX);
}

function renderKaTeX(el) {
  if (!katexReady) return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
    // 横スクロール用の枠を.katex-displayとは別要素に分離する（style.css参照）。
    // 同じ要素にoverflow-x:autoとoverflow-y:visibleを混在させると、CSSの仕様で
    // visibleの方が自動的にauto扱いになり、分数などの上下が縦スクロールで隠れてしまうため。
    el.querySelectorAll('.katex-display').forEach(display => {
      if (display.parentNode.classList.contains('katex-display-wrap')) return; // 二重ラップ防止
      const wrap = document.createElement('div');
      wrap.className = 'katex-display-wrap';
      display.parentNode.insertBefore(wrap, display);
      wrap.appendChild(display);
    });
  } catch(e) {}
}

// ── 名前・学年・クラス管理 ──
function getStudentName()  { return localStorage.getItem('studentName')  || ''; }
function getStudentGrade() { return sessionStorage.getItem('studentGrade') || ''; }
function getStudentClass() { return sessionStorage.getItem('studentClass') || ''; }

// ── 学年・クラスの年度またぎ保存（同じ年度内なら端末に残し、毎回聞き直さない）──
// 日本の学年度は4月始まりなので、1〜3月は前年度の扱いにする
function getCurrentSchoolYear() {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
function gradeStorageKey(name) { return 'savedGrade_' + name; }
function saveGradeForThisYear(name, grade, className) {
  try {
    localStorage.setItem(gradeStorageKey(name), JSON.stringify({ grade, className, schoolYear: getCurrentSchoolYear() }));
  } catch (e) {}
}
// 今年度内に保存された学年・クラスがあれば{grade, className}を返す。無い・年度が違えばnull
// （同じ端末でも生徒名ごとに保存を分けているので、別の生徒がログインしても前の生徒の学年は使われない）
function loadGradeForThisYear(name) {
  try {
    const raw = localStorage.getItem(gradeStorageKey(name));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.schoolYear !== getCurrentSchoolYear()) return null;
    return { grade: data.grade, className: data.className || '' };
  } catch (e) { return null; }
}

// ── ログイン認証（JWT）管理 ──
// ブラウザを閉じても再ログイン不要にするため、localStorageに保存する（JWT自体の有効期限は30日）。
// 端末が生徒一人一台になり共用端末での漏えいリスクが下がったための対応。
// サーバー側は毎回Supabaseの承認状態を再チェックするので、承認取り消しはトークンの有効期限を
// 待たずに即座に反映される
function getAuthToken()   { return localStorage.getItem('authToken') || ''; }
function setAuthToken(t)  { localStorage.setItem('authToken', t); }
function clearAuthToken() { localStorage.removeItem('authToken'); }

// 高校生かどうか（高校生はクラスなし）
function isHighSchool(grade) { return (grade || '').startsWith('高') || grade === '大学入試過去問'; }

// ── 会話履歴の保存・復元（タブを閉じるまでは残る。閉じると次回は消える）──
function saveHistory() {
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
}
function loadHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function clearHistory() {
  history = [];
  sessionStorage.removeItem(HISTORY_KEY);
  document.getElementById('chat-area').innerHTML = '';
}

// APIに送る分だけの履歴：直近の「区切り（次の問題）」より後ろだけを対象にする
function getContextHistory() {
  let startIdx = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'divider') { startIdx = i + 1; break; }
  }
  return history.slice(startIdx).slice(-MAX_HISTORY);
}

function setStudentInfo(name, grade, className) {
  localStorage.setItem('studentName', name);
  sessionStorage.setItem('studentGrade', grade);
  sessionStorage.setItem('studentClass', className);
  document.getElementById('student-name-disp').textContent = className
    ? name + ' さん（' + grade + ' ' + className + '）'
    : name + ' さん（' + grade + '）';
}

// 学年に応じてクラス欄を作り直す（高校生は非表示、Sクラスは中3だけ）
function refreshClassOptions(selectedClass) {
  const grade = document.getElementById('grade-select').value;
  const classField = document.getElementById('class-field');

  // 高校生はクラスなし → クラス欄を隠す
  if (isHighSchool(grade)) {
    classField.style.display = 'none';
    document.getElementById('class-select').value = '';
    return;
  }
  classField.style.display = '';

  const classes = grade === '中3'
    ? ['S（御三家志望）', 'A', 'B', '個別']
    : ['A', 'B', '個別'];
  const sel = document.getElementById('class-select');
  sel.innerHTML = '<option value="">クラスをえらぶ</option>';
  classes.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    if (c === selectedClass) opt.selected = true;
    sel.appendChild(opt);
  });
}

document.getElementById('grade-select').addEventListener('change', () => refreshClassOptions());

function showModalError(msg) {
  const el = document.getElementById('modal-error');
  el.textContent = msg;
  el.classList.add('visible');
}
function hideModalError() {
  const el = document.getElementById('modal-error');
  el.textContent = '';
  el.classList.remove('visible');
}

function showGradeModal() {
  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById('grade-select').value = getStudentGrade();
  refreshClassOptions(getStudentClass());
  hideModalError();
}
function hideGradeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

document.getElementById('btn-name-ok').addEventListener('click', async () => {
  const grade    = document.getElementById('grade-select').value;
  const className = document.getElementById('class-select').value;
  if (!grade)     { showModalError('学年をえらんでね'); return; }
  if (!isHighSchool(grade) && !className) { showModalError('クラスをえらんでね'); return; }
  hideModalError();

  // 学年が未入力だった＝ログイン直後（新規登録 or ブラウザを閉じた後の再ログイン）で
  // このモーダルに来たケース。その場合は会話を再開する必要があるので、単なる挨拶で終わらせず
  // sessionStorage・サーバーの順に会話履歴の復元を試みる（restoreOrGreetForNewSession任せにする）
  const isFirstTime = !getStudentGrade();
  setStudentInfo(getStudentName(), grade, className);
  saveGradeForThisYear(getStudentName(), grade, className);
  hideGradeModal();

  if (isFirstTime) {
    await restoreOrGreetForNewSession();
  } else {
    addSystemMsg('学年・クラスを更新したよ！');
  }
});

document.getElementById('btn-rename').addEventListener('click', showGradeModal);

// ── ログイン・新規登録モーダル ──
function showAuthModal() {
  document.getElementById('auth-overlay').classList.add('active');
}
function hideAuthModal() {
  document.getElementById('auth-overlay').classList.remove('active');
}
function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active', isLogin);
  document.getElementById('tab-register').classList.toggle('active', !isLogin);
  document.getElementById('login-pane').style.display = isLogin ? 'block' : 'none';
  document.getElementById('register-pane').style.display = isLogin ? 'none' : 'block';
}
document.getElementById('tab-login').addEventListener('click', () => switchAuthTab('login'));
document.getElementById('tab-register').addEventListener('click', () => switchAuthTab('register'));

function showAuthError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg;
  el.classList.add('visible');
}
function hideAuthError(elId) {
  const el = document.getElementById(elId);
  el.textContent = '';
  el.classList.remove('visible');
}

// 履歴エントリ（user/model/divider）を順番に画面へ描画する。lastUserTextはAIの吹き出しの
// フィードバック送信時に「どの質問への回答か」を渡すために、直前のuser発言を追いかけておく
function renderHistoryEntries(entries) {
  let lastUserText = '';
  entries.forEach(h => {
    if (h.role === 'user') { addUserBubble(h.text, null); lastUserText = h.text; }
    else if (h.role === 'model') addAIBubble(h.text, lastUserText);
    else if (h.role === 'divider') addDividerMsg(h.text);
  });
}

// ブラウザを閉じた後（sessionStorageが空）でも会話を見返せるよう、サーバーに保存された
// 直近の会話履歴を取得する。取得できなくても通常の新規会話として続行できるよう、
// 失敗時は空配列を返すだけにする（致命的エラーにしない）。
async function fetchInitialServerHistory() {
  try {
    const res = await fetch('/api/history?limit=50', {
      headers: { Authorization: 'Bearer ' + getAuthToken() }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    hasMoreServerHistory = !!data.hasMore;
    oldestLoadedAt = messages.length > 0 ? messages[0].createdAt : null;
    return messages;
  } catch (err) {
    return [];
  }
}

// このタブでの会話表示を再開する（sessionStorageにあればそれを使い、無ければサーバーから
// 復元を試みる）。ログイン直後・学年クラス初回入力後のどちらからも呼ばれる想定
async function restoreOrGreetForNewSession() {
  history = loadHistory();
  if (history.length > 0) {
    renderHistoryEntries(history);
    addSystemMsg('おかえり、' + getStudentName() + ' さん！ 続きから質問できるよ 😊');
    return;
  }
  // このタブでは初回（sessionStorageが空）。ブラウザを閉じる前の会話がサーバーに
  // 残っていれば復元する（無ければ通常の新規会話として続ける）
  const serverMessages = await fetchInitialServerHistory();
  if (serverMessages.length > 0) {
    history = serverMessages.map(m => ({ role: m.role, text: m.text }));
    renderHistoryEntries(history);
    saveHistory();
    addSystemMsg('おかえり、' + getStudentName() + ' さん！ 続きから質問できるよ 😊');
  } else {
    addSystemMsg('おかえり、' + getStudentName() + ' さん！ 質問を入力してね 😊');
    addSystemMsg('別の問題を聞きたくなったら、「次の問題」ボタンを押してね');
  }
}

// ログイン成功後、学年・クラスが未入力ならそちらのモーダルへ、入力済みならそのままチャットを再開する
async function afterLogin() {
  let grade = getStudentGrade();
  let className = getStudentClass();
  if (!grade) {
    // このタブでは未入力（ブラウザを閉じた後の再ログイン等）でも、同じ年度内に選んだ
    // 学年・クラスが端末に残っていればそれを使い、毎回選び直さなくていいようにする
    const saved = loadGradeForThisYear(getStudentName());
    if (saved) { grade = saved.grade; className = saved.className; }
  }
  const classOk = isHighSchool(grade) || className;
  if (!grade || !classOk) {
    showGradeModal();
    return;
  }
  setStudentInfo(getStudentName(), grade, className);
  await restoreOrGreetForNewSession();
}

async function handleLogin() {
  const name = document.getElementById('login-name-input').value.trim();
  const password = document.getElementById('login-password-input').value;
  hideAuthError('login-error');
  if (!name || !password) { showAuthError('login-error', '名前とパスワードを入力してね'); return; }

  const btn = document.getElementById('btn-login-submit');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAuthError('login-error', data.error || 'ログインに失敗しました');
      return;
    }
    setAuthToken(data.token);
    localStorage.setItem('studentName', data.name);
    document.getElementById('login-password-input').value = '';
    hideAuthModal();
    afterLogin();
  } catch (err) {
    showAuthError('login-error', '通信エラーが起きました。もう一度試してね。');
  } finally {
    btn.disabled = false;
  }
}

async function handleRegister() {
  const name = document.getElementById('register-name-input').value.trim();
  const password = document.getElementById('register-password-input').value;
  hideAuthError('register-error');
  document.getElementById('register-success').classList.remove('visible');
  if (!name || !password) { showAuthError('register-error', '名前とパスワードを入力してね'); return; }

  const btn = document.getElementById('btn-register-submit');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showAuthError('register-error', data.error || '登録に失敗しました');
      return;
    }
    document.getElementById('register-name-input').value = '';
    document.getElementById('register-password-input').value = '';

    // 自動承認モードでトークンが発行された場合は、そのままログイン状態にして始める
    if (data.token) {
      setAuthToken(data.token);
      localStorage.setItem('studentName', data.name);
      hideAuthModal();
      afterLogin();
      return;
    }

    const successEl = document.getElementById('register-success');
    successEl.textContent = data.message || '登録を受け付けました。先生が承認するまで少し待ってから、ログインしてね。';
    successEl.classList.add('visible');
  } catch (err) {
    showAuthError('register-error', '通信エラーが起きました。もう一度試してね。');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('btn-login-submit').addEventListener('click', handleLogin);
document.getElementById('btn-register-submit').addEventListener('click', handleRegister);
document.getElementById('login-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
document.getElementById('login-password-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
document.getElementById('register-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleRegister(); });
document.getElementById('register-password-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleRegister(); });

// トークンが無効・失効していた場合の共通処理：ログイン情報を消してログイン画面に戻す
function handleAuthFailure(message) {
  clearAuthToken();
  localStorage.removeItem('studentName');
  sessionStorage.removeItem('studentGrade');
  sessionStorage.removeItem('studentClass');
  clearHistory();
  switchAuthTab('login');
  document.getElementById('login-error').textContent = message || '再度ログインしてください';
  document.getElementById('login-error').classList.add('visible');
  showAuthModal();
}

document.getElementById('btn-logout').addEventListener('click', () => {
  clearAuthToken();
  localStorage.removeItem('studentName');
  sessionStorage.removeItem('studentGrade');
  sessionStorage.removeItem('studentClass');
  clearHistory();
  switchAuthTab('login');
  showAuthModal();
});

// ── チャット表示 ──
function addSystemMsg(text) {
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;font-size:0.8rem;color:var(--color-muted);padding:4px 0;';
  div.textContent = text;
  document.getElementById('chat-area').appendChild(div);
  scrollBottom();
}

function buildDividerNode(text) {
  const div = document.createElement('div');
  div.className = 'history-divider';
  div.textContent = text;
  return div;
}

function addDividerMsg(text) {
  document.getElementById('chat-area').appendChild(buildDividerNode(text));
  scrollBottom();
}

function buildUserBubbleNode(text, imageDataURL) {
  const row = document.createElement('div');
  row.className = 'msg-row user';
  const av = document.createElement('div');
  av.className = 'avatar'; av.textContent = '👤';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    bubble.appendChild(p);
  }
  if (imageDataURL) {
    const img = document.createElement('img');
    img.className = 'preview'; img.src = imageDataURL;
    bubble.appendChild(img);
  }
  row.appendChild(bubble); row.appendChild(av);
  return row;
}

function addUserBubble(text, imageDataURL) {
  document.getElementById('chat-area').appendChild(buildUserBubbleNode(text, imageDataURL));
  scrollBottom();
}

function addLoadingBubble() {
  const row = document.createElement('div');
  row.className = 'msg-row model'; row.id = 'loading-row';
  const av = document.createElement('div');
  av.className = 'avatar'; av.textContent = '🤖';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  row.appendChild(av); row.appendChild(bubble);
  document.getElementById('chat-area').appendChild(row);
  scrollBottom();
}

function removeLoadingBubble() {
  const el = document.getElementById('loading-row');
  if (el) el.remove();
}

// **太字** と ==ハイライト== だけを安全に要素化する（他はテキストノードのまま）
function renderFormattedLine(line) {
  const frag = document.createDocumentFragment();
  const pattern = /\*\*(.+?)\*\*|==(.+?)==/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
    }
    if (match[1] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = match[1];
      frag.appendChild(strong);
    } else {
      const span = document.createElement('span');
      span.className = 'ai-highlight';
      span.textContent = match[2];
      frag.appendChild(span);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < line.length) {
    frag.appendChild(document.createTextNode(line.slice(lastIndex)));
  }
  return frag;
}

// AIの回答テキストをbubbleへ描画する。
// $$...$$（独立行）は\begin{cases}...\end{cases}のように複数行にまたがることがあり、
// 先に改行を<br>へ変換してしまうと数式が別々のテキストノードに分断され、KaTeXが
// $$〜$$のペアを見つけられず生のLaTeXコードがそのまま表示されてしまう不具合があった。
// そのため、$$...$$・$...$の数式部分は改行ごと1つのテキストノードとして丸ごと残し、
// それ以外の地の文だけ改行を<br>に変換して**太字**・==ハイライト==を処理する。
function renderFormattedText(bubble, text) {
  const mathPattern = /\$\$[\s\S]*?\$\$|\$[^\n$]+?\$/g;
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = mathPattern.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ isMath: false, content: text.slice(lastIndex, match.index) });
    segments.push({ isMath: true, content: match[0] });
    lastIndex = mathPattern.lastIndex;
  }
  if (lastIndex < text.length) segments.push({ isMath: false, content: text.slice(lastIndex) });

  let isFirstLine = true;
  segments.forEach(seg => {
    if (seg.isMath) {
      bubble.appendChild(document.createTextNode(seg.content));
      isFirstLine = false;
      return;
    }
    seg.content.split('\n').forEach(line => {
      if (!isFirstLine) bubble.appendChild(document.createElement('br'));
      if (line) bubble.appendChild(renderFormattedLine(line));
      isFirstLine = false;
    });
  });
}

// AIの回答への👍👎フィードバックをサーバーに送る
async function sendFeedback(feedback, questionText, aiReply, containerEl) {
  containerEl.innerHTML = '';
  const thanks = document.createElement('span');
  thanks.className = 'feedback-thanks';
  thanks.textContent = 'ありがとう！';
  containerEl.appendChild(thanks);

  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getAuthToken()
      },
      body: JSON.stringify({
        studentGrade: getStudentGrade(),
        studentClass: getStudentClass(),
        feedback,
        questionText: questionText || '',
        aiReply: aiReply || ''
      })
    });
  } catch (err) {
    // 送れなくても生徒の体験には影響させない（静かに無視）
  }
}

function buildAIBubbleNode(text, questionText) {
  const row = document.createElement('div');
  row.className = 'msg-row model';
  const av = document.createElement('div');
  av.className = 'avatar'; av.textContent = '🤖';
  const bubble = document.createElement('div');
  bubble.className = 'bubble model-bubble';

  // XSS対策：テキストノード・要素生成で安全に処理（innerHTMLは使わない）
  // $...$や$$...$$はKaTeXが後段で処理する
  renderFormattedText(bubble, text);

  const footer = document.createElement('span');
  footer.className = 'ai-footer';
  footer.textContent = '※合っているか不安なときや、まだわからないときは先生に質問してね';
  bubble.appendChild(document.createElement('br'));
  bubble.appendChild(footer);

  const feedbackRow = document.createElement('div');
  feedbackRow.className = 'feedback-row';
  const btnGood = document.createElement('button');
  btnGood.type = 'button'; btnGood.className = 'btn-feedback'; btnGood.textContent = '👍';
  const btnBad = document.createElement('button');
  btnBad.type = 'button'; btnBad.className = 'btn-feedback'; btnBad.textContent = '👎';
  feedbackRow.appendChild(btnGood);
  feedbackRow.appendChild(btnBad);
  btnGood.addEventListener('click', () => sendFeedback('good', questionText, text, feedbackRow));
  btnBad.addEventListener('click', () => sendFeedback('bad', questionText, text, feedbackRow));
  bubble.appendChild(feedbackRow);

  row.appendChild(av); row.appendChild(bubble);
  return { row, bubble };
}

function addAIBubble(text, questionText) {
  const { row, bubble } = buildAIBubbleNode(text, questionText);
  document.getElementById('chat-area').appendChild(row);
  renderKaTeX(bubble);
  scrollBottom();
}

function addErrorBubble(msg) {
  const row = document.createElement('div');
  row.className = 'msg-row model';
  const av = document.createElement('div');
  av.className = 'avatar'; av.textContent = '⚠️';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.cssText = 'background:#FFF0E8;border-color:#F3C4A0;color:#8B3A0F;';
  bubble.textContent = msg;
  row.appendChild(av); row.appendChild(bubble);
  document.getElementById('chat-area').appendChild(row);
  scrollBottom();
}

function scrollBottom() {
  const area = document.getElementById('chat-area');
  area.scrollTop = area.scrollHeight;
}

// ── 過去の会話履歴の追加読み込み（一番上までスクロールしたら自動で古い分を読み込む）──
function buildHistoryEntryNode(h, lastUserTextRef) {
  if (h.role === 'user') {
    lastUserTextRef.text = h.text;
    return buildUserBubbleNode(h.text, null);
  }
  if (h.role === 'model') {
    const { row, bubble } = buildAIBubbleNode(h.text, lastUserTextRef.text);
    renderKaTeX(bubble);
    return row;
  }
  if (h.role === 'divider') return buildDividerNode(h.text);
  return null;
}

async function loadOlderHistoryIfNeeded() {
  if (isLoadingOlderHistory || !hasMoreServerHistory || !oldestLoadedAt) return;
  const area = document.getElementById('chat-area');
  if (area.scrollTop > 40) return; // 一番上付近まで来ていなければ何もしない

  isLoadingOlderHistory = true;
  const loadingEl = document.createElement('div');
  loadingEl.style.cssText = 'text-align:center;font-size:0.78rem;color:var(--color-muted);padding:6px 0;';
  loadingEl.textContent = '過去の会話を読み込み中…';
  area.insertBefore(loadingEl, area.firstChild);

  try {
    const res = await fetch(`/api/history?limit=50&before=${encodeURIComponent(oldestLoadedAt)}`, {
      headers: { Authorization: 'Bearer ' + getAuthToken() }
    });
    if (!res.ok) return;
    const data = await res.json();
    const olderMessages = Array.isArray(data.messages) ? data.messages : [];
    hasMoreServerHistory = !!data.hasMore;
    if (olderMessages.length > 0) {
      oldestLoadedAt = olderMessages[0].createdAt;

      // 直前（＝この追加読み込みバッチより後ろ）のuser発言を、フィードバック送信用に引き継ぐ
      const lastUserTextRef = { text: '' };
      const fragment = document.createDocumentFragment();
      olderMessages.forEach(m => {
        const node = buildHistoryEntryNode(m, lastUserTextRef);
        if (node) fragment.appendChild(node);
      });

      const prevScrollHeight = area.scrollHeight;
      area.insertBefore(fragment, loadingEl);
      // 先頭に追加した分だけ見た目の位置がずれないよう、増えた高さ分スクロール位置を補正する
      area.scrollTop += area.scrollHeight - prevScrollHeight;

      history = [...olderMessages.map(m => ({ role: m.role, text: m.text })), ...history];
      saveHistory();
    }
  } catch (err) {
    // 読み込み失敗してもチャット自体は使えるので、静かに諦める
  } finally {
    loadingEl.remove();
    isLoadingOlderHistory = false;
  }
}

document.getElementById('chat-area').addEventListener('scroll', () => {
  loadOlderHistoryIfNeeded();
});

// ── 画像処理 ──
// JPEGのEXIF Orientationタグ(1〜8)を読み取る。EXIFが無い/JPEGでない/壊れている場合は
// 1(補正不要)を返す。LINEアプリ内蔵ブラウザや一部Android機種では、canvas描画時に
// ブラウザがEXIFの向きを自動補正してくれないことがあり、それが「縦向きで撮った写真しか
// 正しく認識されない」不具合の原因になるため、明示的に読み取って自前で補正する。
function getExifOrientation(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0, false) !== 0xFFD8) return 1; // JPEGではない
    const length = view.byteLength;
    let offset = 2;
    while (offset < length - 1) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) { // APP1 (EXIF)
        if (view.getUint32(offset + 2, false) !== 0x45786966) return 1; // "Exif"ではない
        const tiffOffset = offset + 8;
        const little = view.getUint16(tiffOffset, false) === 0x4949;
        const firstIFDOffset = view.getUint32(tiffOffset + 4, little);
        const dirOffset = tiffOffset + firstIFDOffset;
        const tagCount = view.getUint16(dirOffset, little);
        for (let i = 0; i < tagCount; i++) {
          const entryOffset = dirOffset + 2 + i * 12;
          if (view.getUint16(entryOffset, little) === 0x0112) { // Orientationタグ
            return view.getUint16(entryOffset + 8, little);
          }
        }
        return 1;
      } else if ((marker & 0xFF00) !== 0xFF00) {
        break; // JPEGマーカーではない＝EXIF無し
      } else {
        offset += view.getUint16(offset, false);
      }
    }
  } catch (err) {
    // 壊れたEXIF等は無視して補正なしにフォールバック
  }
  return 1;
}

// EXIF Orientationに応じてcanvasコンテキストに回転・反転を適用する。
// w, hは回転前（＝画像本来の向き）の描画サイズ。
function applyExifTransform(ctx, orientation, w, h) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;  // 左右反転
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break; // 180度回転
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;  // 上下反転
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;   // 左右反転+反時計90度
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;  // 時計回り90度
    case 7: ctx.transform(0, -1, -1, 0, h, w); break; // 左右反転+時計90度
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;  // 反時計回り90度
    default: break; // 1: 補正不要
  }
}

function resizeImage(file, maxPx) {
  return new Promise((resolve) => {
    const exifReader = new FileReader();
    exifReader.onload = (exifEvent) => {
      const orientation = getExifOrientation(exifEvent.target.result);
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (Math.max(w, h) > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else        { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const swapDims = orientation >= 5 && orientation <= 8;
        const canvas = document.createElement('canvas');
        canvas.width = swapDims ? h : w;
        canvas.height = swapDims ? w : h;
        const ctx = canvas.getContext('2d');
        applyExifTransform(ctx, orientation, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objectUrl);
        canvas.toBlob((blob) => {
          const r2 = new FileReader();
          r2.onload = (e2) => resolve({ dataURL: e2.target.result, mimeType: 'image/jpeg' });
          r2.readAsDataURL(blob);
        }, 'image/jpeg', 0.85);
      };
      img.src = objectUrl;
    };
    exifReader.readAsArrayBuffer(file);
  });
}

document.getElementById('btn-image').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const { dataURL, mimeType } = await resizeImage(file, MAX_IMAGE_PX);
  pendingImageBase64 = dataURL.split(',')[1];
  pendingImageMimeType = mimeType;
  document.getElementById('image-preview-thumb').src = dataURL;
  document.getElementById('image-preview-wrap').classList.add('visible');
  e.target.value = '';
});

document.getElementById('btn-remove-img').addEventListener('click', () => {
  pendingImageBase64 = null;
  pendingImageMimeType = null;
  document.getElementById('image-preview-wrap').classList.remove('visible');
  document.getElementById('image-preview-thumb').src = '';
});

// ── テキストエリア自動リサイズ ──
const msgInput = document.getElementById('msg-input');
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
});

// ── 一時的な通信エラー時の自動リトライ ──
// 502（Geminiとの通信エラー）や、fetch自体が失敗した場合のみ対象。
// 400（入力不備）・429（混雑・レート制限）は再送しても解決しないため対象外。
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const RETRYABLE_STATUS = new Set([502]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 25000; // 25秒応答がなければ打ち切る（無応答のままハングし続けるのを防ぐ）

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postChatWithRetry(payload) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getAuthToken()
        },
        body: JSON.stringify(payload)
      });
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === MAX_RETRIES) {
        return res;
      }
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
    }
    await sleep(RETRY_DELAY_MS);
  }
}

// ── 429（混雑）時のカウントダウン付き自動再送 ──
// リトライ待ちの間、生徒が続けて送信できないように入力欄・ボタンをすべてロックする
function setInputsDisabled(disabled) {
  document.getElementById('btn-send').disabled = disabled;
  document.getElementById('msg-input').disabled = disabled;
  document.getElementById('btn-image').disabled = disabled;
  document.getElementById('btn-easier').disabled = disabled;
  document.getElementById('btn-skip').disabled = disabled;
  document.getElementById('btn-new-problem').disabled = disabled;
}

async function showRetryCountdown(sec) {
  const row = document.createElement('div');
  row.className = 'msg-row model';
  const av = document.createElement('div');
  av.className = 'avatar'; av.textContent = '⏳';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  row.appendChild(av); row.appendChild(bubble);
  document.getElementById('chat-area').appendChild(row);
  for (let s = sec; s > 0; s--) {
    bubble.textContent = 'いま少し混み合ってるみたい。あと' + s + '秒したら、もう一度自動で送るね。そのまま待っててね…';
    scrollBottom();
    await sleep(1000);
  }
  row.remove();
}

// ── 送信 ──
async function sendMessage() {
  if (isSending) return;
  const text = msgInput.value.trim();
  if (!text && !pendingImageBase64) return;
  if (!getAuthToken()) { showAuthModal(); return; }
  const studentGrade = getStudentGrade();
  const studentClass = getStudentClass();
  const classOk = isHighSchool(studentGrade) || studentClass;
  if (!studentGrade || !classOk) { showGradeModal(); return; }

  isSending = true;
  document.getElementById('btn-send').disabled = true;

  const imageDataURL = pendingImageBase64
    ? 'data:' + pendingImageMimeType + ';base64,' + pendingImageBase64
    : null;

  addUserBubble(text, imageDataURL);
  msgInput.value = '';
  msgInput.style.height = 'auto';

  const imgB64 = pendingImageBase64;
  const imgMime = pendingImageMimeType;
  pendingImageBase64 = null;
  pendingImageMimeType = null;
  document.getElementById('image-preview-wrap').classList.remove('visible');
  document.getElementById('image-preview-thumb').src = '';

  addLoadingBubble();

  const payload = {
    studentGrade,
    studentClass,
    message: text,
    imageBase64: imgB64 || null,
    imageMimeType: imgMime || null,
    history: getContextHistory()
  };

  const handleSuccess = async (res) => {
    const data = await res.json();
    const reply = data.reply || '（回答を取得できませんでした）';
    addAIBubble(reply, text);
    // 画像のみ（テキストなし）の質問も、会話の文脈から欠落しないようプレースホルダーを積む
    history.push({ role: 'user', text: text || '（画像で質問した）' });
    history.push({ role: 'model', text: reply });
    saveHistory();
  };

  try {
    const res = await postChatWithRetry(payload);

    removeLoadingBubble();

    if (res.ok) {
      await handleSuccess(res);
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401) {
        handleAuthFailure(errData.error || 'ログインの有効期限が切れたみたい。もう一度ログインしてね。');
      } else if (res.status === 429 && errData.retryAfterSec) {
        // 分あたり制限（混雑）：カウントダウン後に1回だけ自動再送。
        // その間は入力欄・ボタンをロックして、生徒が続けて送れないようにする
        setInputsDisabled(true);
        const waitSec = Math.min(errData.retryAfterSec, 90) + Math.floor(Math.random() * 5);
        await showRetryCountdown(waitSec);
        addLoadingBubble();
        const res2 = await postChatWithRetry(payload);
        removeLoadingBubble();
        if (res2.ok) {
          await handleSuccess(res2);
        } else {
          const errData2 = await res2.json().catch(() => ({}));
          if (errData2.limitType === 'daily') {
            addErrorBubble(errData2.error || '⏳ 今日はAIへの質問が上限に達しちゃったみたい。また明日質問してね。');
          } else {
            addErrorBubble('⏳ まだ混み合ってるみたい。少し時間をおいてから、もう一度送ってみてね。');
          }
        }
      } else {
        addErrorBubble(errData.error || 'エラーが発生しました。もう一度試してね。');
      }
    }
  } catch(err) {
    removeLoadingBubble();
    addErrorBubble('通信エラーです。インターネット接続を確認してね。');
  }

  isSending = false;
  setInputsDisabled(false);
  msgInput.focus();
}

document.getElementById('btn-send').addEventListener('click', sendMessage);

// 「もっとやさしく」ボタン：直前の説明をやさしく言い直してもらう
document.getElementById('btn-easier').addEventListener('click', () => {
  if (isSending) return;
  const hasAIReply = history.some(h => h.role === 'model');
  if (!hasAIReply) {
    addSystemMsg('まずは質問してね。そのあとで「もっとやさしく」が使えるよ 😊');
    return;
  }
  msgInput.value = 'さっきの説明が少しむずかしかったよ。小学生にもわかるくらい、もっとやさしく、もっと短く教えて。';
  sendMessage();
});

// 「もうわかった、先へ」ボタン：分かっている説明を繰り返さず、手短に次へ進んでもらう
document.getElementById('btn-skip').addEventListener('click', () => {
  if (isSending) return;
  const hasAIReply = history.some(h => h.role === 'model');
  if (!hasAIReply) {
    addSystemMsg('まずは質問してね。そのあとで「もうわかった、先へ」が使えるよ 😊');
    return;
  }
  msgInput.value = 'ここまではもう分かったよ。同じような説明は繰り返さなくていいから、手短に次のステップへ進んで。';
  sendMessage();
});

// 「次の問題」ボタン：これまでの会話は画面に残したまま、AIに送る文脈だけ区切る
document.getElementById('btn-new-problem').addEventListener('click', () => {
  if (isSending) return;
  const hasAIReply = history.some(h => h.role === 'model');
  if (!hasAIReply) {
    addSystemMsg('まずは質問してね。そのあとで「次の問題」が使えるよ 😊');
    return;
  }
  history.push({ role: 'divider', text: '次の問題' });
  saveHistory();
  addDividerMsg('次の問題');
});

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── 初期化 ──
(function init() {
  if (!getAuthToken() || !getStudentName()) {
    showAuthModal();
  } else {
    afterLogin();
  }
})();
