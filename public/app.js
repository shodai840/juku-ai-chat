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
  } catch(e) {}
}

// ── 名前・学年・クラス管理 ──
function getStudentName()  { return sessionStorage.getItem('studentName')  || ''; }
function getStudentGrade() { return sessionStorage.getItem('studentGrade') || ''; }
function getStudentClass() { return sessionStorage.getItem('studentClass') || ''; }

// ── ログイン認証（JWT）管理 ──
function getAuthToken()   { return sessionStorage.getItem('authToken') || ''; }
function setAuthToken(t)  { sessionStorage.setItem('authToken', t); }
function clearAuthToken() { sessionStorage.removeItem('authToken'); }

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
  sessionStorage.setItem('studentName', name);
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

document.getElementById('btn-name-ok').addEventListener('click', () => {
  const grade    = document.getElementById('grade-select').value;
  const className = document.getElementById('class-select').value;
  if (!grade)     { showModalError('学年をえらんでね'); return; }
  if (!isHighSchool(grade) && !className) { showModalError('クラスをえらんでね'); return; }
  hideModalError();

  const isFirstTime = !getStudentGrade();
  setStudentInfo(getStudentName(), grade, className);
  hideGradeModal();

  if (isFirstTime) {
    addSystemMsg('こんにちは、' + getStudentName() + ' さん！ 質問を気軽に入力してね 😊');
    addSystemMsg('別の問題を聞きたくなったら、「次の問題」ボタンを押してね');
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

// ログイン成功後、学年・クラスが未入力ならそちらのモーダルへ、入力済みならそのままチャットを再開する
function afterLogin() {
  const grade = getStudentGrade();
  const className = getStudentClass();
  const classOk = isHighSchool(grade) || className;
  if (!grade || !classOk) {
    showGradeModal();
    return;
  }
  setStudentInfo(getStudentName(), grade, className);
  history = loadHistory();
  if (history.length > 0) {
    let lastUserText = '';
    history.forEach(h => {
      if (h.role === 'user') { addUserBubble(h.text, null); lastUserText = h.text; }
      else if (h.role === 'model') addAIBubble(h.text, lastUserText);
      else if (h.role === 'divider') addDividerMsg(h.text);
    });
    addSystemMsg('おかえり、' + getStudentName() + ' さん！ 続きから質問できるよ 😊');
  } else {
    addSystemMsg('おかえり、' + getStudentName() + ' さん！ 質問を入力してね 😊');
    addSystemMsg('別の問題を聞きたくなったら、「次の問題」ボタンを押してね');
  }
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
    sessionStorage.setItem('studentName', data.name);
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
      sessionStorage.setItem('studentName', data.name);
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
  sessionStorage.removeItem('studentName');
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
  sessionStorage.removeItem('studentName');
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

function addDividerMsg(text) {
  const div = document.createElement('div');
  div.className = 'history-divider';
  div.textContent = text;
  document.getElementById('chat-area').appendChild(div);
  scrollBottom();
}

function addUserBubble(text, imageDataURL) {
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
  document.getElementById('chat-area').appendChild(row);
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

function addAIBubble(text, questionText) {
  const row = document.createElement('div');
  row.className = 'msg-row model';
  const av = document.createElement('div');
  av.className = 'avatar'; av.textContent = '🤖';
  const bubble = document.createElement('div');
  bubble.className = 'bubble model-bubble';

  // XSS対策：テキストノード・要素生成で安全に処理（innerHTMLは使わない）
  // $...$や$$...$$はKaTeXが後段で処理する
  // 改行を<br>に変換しつつ、**太字**・==ハイライト==だけ要素化して描画
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) bubble.appendChild(document.createElement('br'));
    bubble.appendChild(renderFormattedLine(line));
  });

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

// ── 画像処理 ──
function resizeImage(file, maxPx) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (Math.max(w, h) > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else        { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          const r2 = new FileReader();
          r2.onload = (e2) => resolve({ dataURL: e2.target.result, mimeType: 'image/jpeg' });
          r2.readAsDataURL(blob);
        }, 'image/jpeg', 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
