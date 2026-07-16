// LINE Messaging APIで管理者にpush通知を送る（承認自体は管理画面で行う。Webhookは使わない）
export async function sendLineNotification(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const to = process.env.LINE_ADMIN_USER_ID;
  if (!token || !to) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN / LINE_ADMIN_USER_ID が設定されていません');
    return;
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text: String(text).slice(0, 5000) }]
      })
    });
    if (!res.ok) {
      console.error('LINE通知送信エラー:', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('LINE通知送信失敗（無視）:', err);
  }
}
