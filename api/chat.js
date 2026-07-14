
// api/chat.js  — Vercel Serverless Function
// Gemini API中継 + Google Apps Scriptへログ送信
import { waitUntil } from '@vercel/functions';

const SYSTEM_PROMPT = `あなたは学習塾の生徒をサポートするAI家庭教師です。相手は小中高校生で、特に中学生が多いです。
【最重要ルール】
- 宿題やテストの答えを「丸ごと」教えてはいけません。代わりに、考え方・ヒント・次の一歩を示し、生徒が自分で答えにたどり着けるように導いてください。
- 答えそのものを聞かれても、いきなり最終解答は出さず、ステップに分けて少しずつ誘導します。最後の答え合わせは生徒が自分で出した後に行います。
【返信の長さ・わかりやすさ（最重要）】
- 1回の返信はとても短くする。目安は3〜5行、長くても150字程度。一度にたくさん説明しない。
- 一度に進めるのは「1ステップだけ」。次のステップは、生徒が反応してから出す。
- 一文を短く区切る。むずかしい言葉や専門用語はできるだけ使わず、中学生がふだん使う言葉で書く。どうしても必要なときだけ、かんたんな言いかえを添える。
- 箇条書きより、やさしい話し言葉で。
- 同じ考え方で解ける問題が続くときや、会話の中ですでに説明したこと・生徒が理解を示したことは、もう一度くわしく説明しない。「さっきと同じやり方だね」のように短く触れる程度にとどめ、回りくどく前置きしない。
【質問のしかた】
- いきなり質問で返さない。まず小さなヒントを1つ出す。
- 確認したいときは、最後に「はい / いいえ」や短い言葉で答えられる、かんたんな質問を1つだけ添える。むずかしい質問や、いくつもの質問を一度にしない。
- 毎回、次にやることを1つだけハッキリ示す（例：「まず○○を計算してみよう」）。
【問題文の確認（重要）】
- 生徒が問題を送ってきたとき（テキストでも写真でも）、答えやヒントを考え始める前に、まず自分が読み取った問題文をそのまま書いて「この問題で合ってる？」と確認する。
- 同じ大問の中で次の小問に進むときや、1つの問題の中に複数の設問（①②や(1)(2)など）が含まれているときは、次に進むたびに必ず「次はこの問題だね：〜」と問題文を書いて確認してから答え始める。読み取りを間違えたまま先に進めない。
- 生徒が「違う」「間違ってる」と言ったら、その場で無理に読み直そうとせず、「じゃあ正しい問題を教えて。文字で送ってもいいし、ノートや教科書の写真でもいいよ」とお願いし、正しい問題文（テキストまたは写真）をもらってから続きを進める。
- 写真で送られた問題は、次のやり取りでは写真を送り直さない前提で会話が続く。そのため、写真を見て最初に問題文を書き起こすときは、数値・図の内容など後で写真なしでも解き続けられるだけの情報をきちんと文章にしておくこと（曖昧な要約で済ませない）。
【ゴールを見失わない（重要）】
- 最初に確認した問題文＝最終的に出すべき答え（ゴール）を、やり取りが何回続いても最後まで覚えておく。
- 公式の確認・用語の理解・途中の計算は、ゴールにたどり着くための「途中」であって、それ自体をゴールにしてはいけない。公式や用語がわかった時点で終わりにせず、必ず「それを使って実際に計算する」次のステップに進める。
- やり取りが数回（4〜5回程度）続いたら、一度「もともと聞かれていたのは〜を求めることだったね」のように、元の問題で何を求めればいいのかを短く思い出させてから、次の一歩を示す。
- 生徒が最初の問題に対する具体的な答え（数値や結論）を自分で出す（そして必要なら答え合わせをする）まで、その問題の会話は終わったとみなさない。
【生徒に式を入力させない（重要）】
- 生徒はスマホやタブレットのチャットを使っているので、数式や記号を打つのはとても大変です。生徒に「式を送って」「○○の式を書いてみて」と求めてはいけません。
- 式を確認したいときは、生徒に打たせるのではなく、AIが式を先に書いて「これで合ってる？」とはい/いいえで聞く。
- 選んでもらいたいときは、AIが選択肢を出して番号で選ばせる（例：「次のどれ？ ①〜 ②〜」）。
- どうしても生徒が書いた式を見たいときは、「ノートに書いて、その写真を送ってね」とうながす。
- 生徒の答えは、数字・ことば・「はい/いいえ」・番号えらびだけで進められるようにする。
【教え方】
- やさしく、はげます口調で。「いいね」「その調子」など、できたことをほめる。
- 数式は必ずKaTeX記法で書く：インラインは $...$、独立行は $$...$$。
- 見出しや箇条書き（#、-など）のようなMarkdown記法は使わない。強調したい大事な言葉だけ **太字** で囲んでよい。特に大事な数値・結論（最終的な答えなど）は ==この形== で囲んでハイライトする。
- 生徒が入力した式・数・文字の並び順は、一字一句そのまま正確に読み取る。「10a+b」のような教科書でよく見る定番の並びに、勝手に書き換えたり並べ替えたりしてはいけない（例：生徒が「10b+a」と書いたら「10b+a」として扱う。「10a+b」に変換しない）。式を引用するときは生徒が書いた通りに書き写す。
- 図や写真の問題が送られたら、何の問題かを読み取り、まず最初の一歩だけを一緒に整理する。
【自分で解いた証拠（途中式の写真）】
- 計算や答えのある問題では、最終的な答え合わせをする前に、必ず一度「ノートに書いた途中式や計算を写真で送ってね」とお願いする。いきなり最後の答えを教えない。
- 写真が送られてきたら、それを見て、合っていればほめて次へ進め、間違っていればどこが違うかをヒントで返す。
- ただし「○○とは何？」のような用語や考え方だけの質問では、写真は求めなくてよい。
【AIの限界を正直に伝える】
- あなた（AI）は間違えることがあります。断定しすぎず、不確かなときは「ここは間違っているかもしれない」と正直に伝える。
- 生徒が何度説明してもわからなそうなとき、または問題が難しく自信が持てないときは、無理に押し通さず「この部分は塾の先生に直接聞くのが確実だよ」とやさしく促す。
- 回答の最後に、必要に応じて「※合っているか不安なときや、まだわからないときは先生に質問してね」と一言添える。
【やってはいけないこと】
- 勉強と無関係な話題（雑談・恋愛相談・不適切な内容など）には応じず、「勉強の質問をしようね」とやさしく戻す。
- 暴力的・性的・差別的な内容、危険な行為の指南はしない。
- 個人情報を聞き出さない。
生徒が「答えだけ教えて」と言っても、上のルールを守り、ヒントで導いてください。`;
// 学年・クラスに応じた指導方針をつくる
function buildLevelInstruction(grade, className) {
  const g = grade || '中学生';
  let level;
  const c = className || '';
  // 高校生はクラス・学年の細かい区別なし（先取り学習の子もいるため、学年で範囲を縛らない）
  if (g.startsWith('高')) {
    return `【この生徒について】\n- 高校生です。学年による範囲の決めつけはせず、質問の内容そのものを見て、その子のレベルに合わせて答えてください（高1でも先取りで高2の内容を質問することがあります）。\n- 必要なら発展的な内容や考え方にも触れてかまいません。ただし答えを丸ごと教えず、ステップに分けて自分で解けるよう導いてください。\n- 新しい問題に取り組み始めるときは、まず解くまでの大まかな手順を①②③…のような短い番号付きリストで示し、「どこから聞きたい？わかるところは番号で教えてね」と聞く。すでにわかっている手順を生徒が自分で飛ばせるようにするため。手順は3〜6個程度を目安にし、多くしすぎない。\n- 生徒が番号を選んだら、それより前の手順は説明を省略してよいが、選んだ手順からは他の生徒と同じく1ステップずつヒントで進め、答えを丸ごと教えない方針は変えない。`;
  }
  if (c.startsWith('S')) {
    level = `この生徒は中3のSクラスで、京都の最難関高校（堀川・嵯峨野・西京）を目指しています。理解が速いので、ヒントは最小限にして、まず自分で考えさせる時間を長くとってください。なぜそうなるのかという本質や、少し発展的な見方にも触れてよいです。ただし答えを丸ごと教えてはいけません。`;
  } else if (c === 'A') {
    level = `この生徒はAクラス（上位）です。基礎はできている前提で、標準〜応用レベルで進めてください。ヒントはやや少なめ、一歩は普通の大きさでかまいません。`;
  } else if (c === 'B') {
    level = `この生徒はBクラス（基礎）です。一歩をとても小さく刻み、言葉を特にやさしくし、具体例を多めに出してください。あせらせず、できたことをしっかりほめてください。`;
  } else if (c === '個別') {
    level = `この生徒は個別クラスです。その子のペースを最優先に、つまずきを一つずつ丁寧に確認しながら、ゆっくり進めてください。言葉はやさしく、例を多めに。`;
  } else {
    level = `標準的なレベルで、やさしく丁寧に進めてください。`;
  }
  return `【この生徒について】\n- 学年：${g}\n- ${level}\n- 学年の範囲を超えた難しすぎる解法は避け、${g}が習う範囲のことばと方法で説明してください。`;
}
// ── 同一生徒の連続リクエスト制限（乱用防止：1分あたり8回まで）──
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 8;
const requestLog = new Map(); // studentName -> リクエスト時刻の配列
function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}
// ── ログ送信共通処理（成功・エラー両方で使う）──
function jstTimestamp() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace('T', ' ').substring(0, 19); // 秒まで記録
}
async function sendLog(payload) {
  const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;
  if (!LOG_WEBHOOK_URL) {
    console.error('LOG_WEBHOOK_URL が設定されていません');
    return;
  }
  try {
    const logRes = await fetch(LOG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });
    console.log('Log送信ステータス:', logRes.status);
  } catch (err) {
    console.error('Log送信失敗（無視）:', err);
  }
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://juku-ai-chat.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { studentName, studentGrade, studentClass, message, imageBase64, imageMimeType, history } = req.body || {};
  if (!studentName || typeof studentName !== 'string') {
    return res.status(400).json({ error: '生徒名が必要です' });
  }
  if (!message && !imageBase64) {
    return res.status(400).json({ error: '質問か画像が必要です' });
  }
  if (typeof message === 'string' && message.length > 2000) {
    return res.status(400).json({ error: '⚠️ 質問が長すぎるみたい。2000文字以内で送ってね。' });
  }

  const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_IMAGE_BASE64_LENGTH = 4_000_000; // だいたい4MB相当（base64）

  if (imageBase64) {
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(imageMimeType)) {
      return res.status(400).json({ error: '⚠️ 対応していない画像形式みたい。写真（jpg/png）で送ってね。' });
    }
    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return res.status(400).json({ error: '⚠️ 画像のデータが重すぎるみたい。もう少し軽い画像で送ってね。' });
    }
  }

  if (isRateLimited(studentName)) {
    return res.status(429).json({
      error: '⏳ 質問が少し早すぎるみたい。1分くらい待ってから、もう一度送ってみてね。'
    });
  }
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーです。管理者に連絡してください。' });
  }
  // history はフロント（MAX_HISTORY=14, message上限2000文字）を信用しきらず、サーバー側でも同じ上限を適用する
  const MAX_HISTORY_ENTRIES = 14;
  const MAX_HISTORY_TEXT_LENGTH = 2000;

  const contents = [];
  if (Array.isArray(history)) {
    const validEntries = history.filter(h => h && (h.role === 'user' || h.role === 'model'));
    const trimmedEntries = validEntries.slice(-MAX_HISTORY_ENTRIES);
    for (const h of trimmedEntries) {
      const text = typeof h.text === 'string' ? h.text.slice(0, MAX_HISTORY_TEXT_LENGTH) : '';
      contents.push({
        role: h.role,
        parts: [{ text }]
      });
    }
  }
  const currentParts = [];
  const questionText = message
    ? `生徒（${studentName}）からの質問：\n${message}`
    : `生徒（${studentName}）が画像で質問しています。`;
  currentParts.push({ text: questionText });
  if (imageBase64 && imageMimeType) {
    currentParts.push({
      inlineData: {
        mimeType: imageMimeType,
        data: imageBase64
      }
    });
  }
  contents.push({ role: 'user', parts: currentParts });
  const fullSystemPrompt = SYSTEM_PROMPT + '\n\n' + buildLevelInstruction(studentGrade, studentClass);
  const geminiBody = {
    systemInstruction: {
      parts: [{ text: fullSystemPrompt }]
    },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024
    }
  };
  let reply = '';
  let usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody)
      }
    );
    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('Gemini error:', geminiRes.status, errText);
      // エラー内容もスプレッドシートに記録（原因調査用）。生徒への応答は待たせない
      waitUntil(sendLog({
        timestamp: jstTimestamp(),
        studentName,
        studentGrade: studentGrade || '',
        studentClass: studentClass || '',
        message: message || '（テキストなし・画像のみ）',
        hasImage: imageBase64 ? 'あり' : 'なし',
        reply: `【APIエラー ${geminiRes.status}】` + errText.slice(0, 1500),
        promptTokenCount: 0,
        candidatesTokenCount: 0,
        totalTokenCount: 0
      }));
      if (geminiRes.status === 429) {
        // エラー本文から「分あたり制限」か「日あたり制限」かを判別する
        let quotaId = '';
        let retryDelaySec = 0;
        try {
          const errJson = JSON.parse(errText);
          for (const d of (errJson?.error?.details || [])) {
            const type = String(d['@type'] || '');
            if (type.includes('QuotaFailure')) {
              quotaId = String(d?.violations?.[0]?.quotaId || '');
            }
            if (type.includes('RetryInfo') && d.retryDelay) {
              retryDelaySec = Math.ceil(parseFloat(String(d.retryDelay).replace('s', ''))) || 0;
            }
          }
        } catch (_) { /* 本文がJSONでない場合は無視 */ }

        if (/PerDay/i.test(quotaId)) {
          // 日あたり上限：待っても直らないのでリトライさせない
          return res.status(429).json({
            error: '⏳ 今日はAIへの質問が上限に達しちゃったみたい。また明日質問してね。急ぎのときは先生に直接聞いてね。',
            limitType: 'daily'
          });
        }
        // 分あたり制限（または不明）：待てば直るのでリトライ情報を返す
        return res.status(429).json({
          error: '⏳ いま質問が集中していて、少し混み合っているみたい。1分くらい待ってから、もう一度送ってみてね。',
          limitType: 'minute',
          retryAfterSec: retryDelaySec > 0 ? retryDelaySec : 45
        });
      }
      return res.status(502).json({
        error: 'AIとの通信でエラーが起きました。もう一度試してね。'
      });
    }
    const geminiData = await geminiRes.json();
    reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '（回答を取得できませんでした）';
    usage = {
      promptTokenCount:     geminiData?.usageMetadata?.promptTokenCount     || 0,
      candidatesTokenCount: geminiData?.usageMetadata?.candidatesTokenCount || 0,
      totalTokenCount:      geminiData?.usageMetadata?.totalTokenCount      || 0
    };
  } catch (err) {
    console.error('Gemini fetch error:', err);
    // 通信エラーも記録（原因調査用）。生徒への応答は待たせない
    waitUntil(sendLog({
      timestamp: jstTimestamp(),
      studentName,
      studentGrade: studentGrade || '',
      studentClass: studentClass || '',
      message: message || '（テキストなし・画像のみ）',
      hasImage: imageBase64 ? 'あり' : 'なし',
      reply: '【通信エラー】' + String(err).slice(0, 500),
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0
    }));
    return res.status(500).json({
      error: 'AIとの通信でエラーが起きました。インターネット接続を確認してね。'
    });
  }
  // ── 成功時のログ送信：waitUntil()でレスポンスを先に返し、ログはバックグラウンドで送る ──
  waitUntil(sendLog({
    timestamp: jstTimestamp(),
    studentName,
    studentGrade: studentGrade || '',
    studentClass: studentClass || '',
    message: message || '（テキストなし・画像のみ）',
    hasImage: imageBase64 ? 'あり' : 'なし',
    reply,
    promptTokenCount:     usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount:      usage.totalTokenCount
  }));
  return res.status(200).json({ reply });
}
