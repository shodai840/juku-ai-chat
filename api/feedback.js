
// api/feedback.js  — Vercel Serverless Function
// AIの回答への👍👎フィードバックを受け取り、Geminiで科目を判定してからApps Scriptへ送信
import { waitUntil } from '@vercel/functions';

function jstTimestamp() {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace('T', ' ').substring(0, 19); // 秒まで記録
}

// ── 同一生徒の連続送信制限（乱用防止：1分あたり20回まで）──
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const requestLog = new Map(); // studentName -> リクエスト時刻の配列

function isRateLimited(key) {
  const now = Date.now();
  const timestamps = (requestLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// 質問文から教科を1語で判定する（判定できなければ「不明」）。トークン数も一緒に返す
async function classifySubject(questionText, GEMINI_API_KEY) {
  const emptyUsage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
  if (!questionText) return { subject: '不明', usage: emptyUsage };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: '次の生徒の質問がどの教科か判定してください。「数学」「英語」「国語」「理科」「社会」「その他」のうち、あてはまる1語だけを出力してください。それ以外は何も書かないでください。' }]
          },
          contents: [{ role: 'user', parts: [{ text: questionText }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 }
        })
      }
    );
    if (!res.ok) return { subject: '不明', usage: emptyUsage };
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '不明';
    const usage = {
      promptTokenCount:     data?.usageMetadata?.promptTokenCount     || 0,
      candidatesTokenCount: data?.usageMetadata?.candidatesTokenCount || 0,
      totalTokenCount:      data?.usageMetadata?.totalTokenCount      || 0
    };
    return { subject: text.slice(0, 10), usage };
  } catch (err) {
    console.error('科目判定エラー:', err);
    return { subject: '不明', usage: emptyUsage };
  }
}

async function sendFeedbackLog(payload) {
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
    console.log('フィードバックログ送信ステータス:', logRes.status);
  } catch (err) {
    console.error('フィードバックログ送信失敗（無視）:', err);
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

  const { studentName, studentGrade, studentClass, feedback, questionText, aiReply } = req.body || {};

  if (!studentName || typeof studentName !== 'string') {
    return res.status(400).json({ error: '生徒名が必要です' });
  }
  if (feedback !== 'good' && feedback !== 'bad') {
    return res.status(400).json({ error: '評価の値が不正です' });
  }
  if (isRateLimited(studentName)) {
    return res.status(429).json({ error: '⏳ 少し送りすぎみたい。少し待ってからもう一度試してね。' });
  }

  const safeQuestion = typeof questionText === 'string' ? questionText.slice(0, 2000) : '';
  const safeReply = typeof aiReply === 'string' ? aiReply.slice(0, 2000) : '';
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // 科目判定・ログ送信とも生徒の応答を待たせず、バックグラウンドで行う
  waitUntil((async () => {
    const { subject, usage } = GEMINI_API_KEY
      ? await classifySubject(safeQuestion, GEMINI_API_KEY)
      : { subject: '不明', usage: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 } };
    await sendFeedbackLog({
      type: 'feedback',
      timestamp: jstTimestamp(),
      studentName,
      studentGrade: studentGrade || '',
      studentClass: studentClass || '',
      feedback: feedback === 'good' ? '👍' : '👎',
      subject,
      questionText: safeQuestion,
      aiReply: safeReply,
      promptTokenCount:     usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      totalTokenCount:      usage.totalTokenCount
    });
  })());

  return res.status(200).json({ status: 'ok' });
}
