import { SCRIPT_URL } from './config.js';

// Apps Script Web App 不支援 CORS preflight，所以用 text/plain + no-cors 送出。
// no-cors 拿不到回應內容；只要請求有送出就視為成功。
export async function submitScore(payload) {
  if (!SCRIPT_URL) return { status: 'disabled' };
  try {
    await fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return { status: 'sent' };
  } catch {
    return { status: 'error' };
  }
}
