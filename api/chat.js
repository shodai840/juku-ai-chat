// api/chat.js  — Vercel Serverless Function
// Gemini API中継 + Google Apps Scriptへログ送信

const SYSTEM_PROMPT = `あなたは学習塾の生徒をサポートするAI家庭教師です。相手は小中高校生です。

【最重要ルール】
- 宿題やテストの答えを「丸ごと」教えてはいけません。代わりに、考え方・ヒント・次の一歩を示し、生徒が自分で答えにたどり着けるように導いてください。
- まず生徒がどこまで分かっているか・どこでつまずいているかを1〜2問の短い質問で確認してから説明してください。
- 答えそのものを聞かれても、いきなり最終解答は出さず、「一緒に解いてみよう」とステップに分けて誘導します。最後の答え合わせは生徒が自分で出した後に行います。

【教え方】
- やさしく、はげます口調で。専門用語は中高生にわかる言葉で言い換える。
- 数式は必ずKaTeX記法で書く：インラインは $...$、独立行は $$...$$。
- 図や写真の問題が送られたら、何の問題かを読み取り、解き方の方針から一緒に整理する。
- 長くなりすぎないよう、1回の返信は要点を絞る。

【AIの限界を正直に伝える】
- あなた（AI）は間違えることがあります。断定しすぎず、不確かなときは「ここは間違っているかもしれない」と正直に伝える。
- 生徒が何度説明してもわからなそうなとき、または問題が難しく自信が持てないときは、無理に押し通さず「この部分は塾の先生に直接聞くのが確実だよ」とやさしく促す。
- 回答の最後に、必要に応じて「※合っているか不安なときや、まだわからないときは先生に質問してね」と一言添える。

【やってはいけないこと】
- 勉強と無関係な話題（雑談・恋愛相談・不適切な内容など）には応じず、「勉強の質問をしようね」とやさしく戻す。
- 暴力的・性的・差別的な内容、危険な行為の指南はしない。
- 個人情報を聞き出さない。

生徒が「答えだけ教えて」と言っても、上のルールを守り、ヒントで導いてください。`;

export default async function handler(req, res) {
  // CORSヘッダー（必要なら）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 入力取得 ──
  const { studentName, message, imageBase64, imageMimeType, history } = req.body || {};

  if (!studentName || typeof studentName !== 'string') {
    return res.status(400).json({ error: '生徒名が必要です' });
  }
  if (!message && !imageBase64) {
    return res.status(400).json({ error: '質問か画像が必要です' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY が設定されていません');
    return res.status(500).json({ error: 'サーバー設定エラーです。管理者に連絡してください。' });
  }

  // ── Gemini リクエスト組み立て ──
  const contents = [];

  // 過去の会話履歴
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h.role === 'user' || h.role === 'model') {
        contents.push({
          role: h.role,
          parts: [{ text: h.text || '' }]
        });
      }
    }
  }

  // 今回の質問（テキスト + 任意で画像）
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

  const geminiBody = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024
    }
  };

  // ── Gemini API 呼び出し ──
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

    if (geminiRes.status === 429) {
      return res.status(429).json({
        error: '今混み合っています。少し待ってからもう一度試してね。'
      });
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => '');
      console.error('Gemini error:', geminiRes.status, errText);
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
    return res.status(500).json({
      error: 'AIとの通信でエラーが起きました。インターネット接続を確認してね。'
    });
  }

  // ── ログ送信（失敗してもチャットは止めない） ──
  const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL;
  if (LOG_WEBHOOK_URL) {
    // JST変換（UTC+9）
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const timestamp = jst.toISOString().replace('T', ' ').substring(0, 16);

    const logPayload = {
      timestamp,
      studentName,
      message: message || '（テキストなし・画像のみ）',
      hasImage: imageBase64 ? 'あり' : 'なし',
      reply,
      promptTokenCount:     usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      totalTokenCount:      usage.totalTokenCount
    };

    fetch(LOG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logPayload)
    }).catch((err) => {
      console.error('Log送信失敗（無視）:', err);
    });
  }

  // ── レスポンス ──
  return res.status(200).json({ reply });
}
