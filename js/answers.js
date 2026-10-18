// 課文理解、句型練習的答案不公開：題目分成兩份
//   public/content_<單元>   學生網站下載的：拿掉答案、解析、依據、錯誤分析（作答只需要題目和選項）
//   secure/content_<單元>   完整的：只有老師（後台編輯）和伺服器計分（functions/index.js）讀得到
// 學生交卷後，伺服器才把完整內容給這位學生做檢討；句型練習的正式測驗每題作答時由伺服器判斷並回傳那一題的答案。
// 單字片語的答案就是單字表本身，照舊公開。Apps Script（Code.gs 的 stripContent_）有同一套規則，改這裡要一起改。

// 這個單元的題目有沒有要藏起來的答案
export const hasSecret = (data) => !!data && (Array.isArray(data.questions) || Array.isArray(data.items));

const READING_SECRET = ['answer', 'explain', 'key', 'ref', 'traps', 'kw', 'pairs'];
const PATTERN_SECRET = ['answer', 'explain'];
const omit = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));

// 學生作答時看得到的版本
export function stripContent(data) {
  if (!hasSecret(data)) return data;
  const out = { ...data };
  if (Array.isArray(data.questions)) out.questions = data.questions.map((q) => omit(q, READING_SECRET));
  if (Array.isArray(data.items)) out.items = data.items.map((it) => omit(it, PATTERN_SECRET));
  out.locked = true; // 網站看到這個就知道答案要跟伺服器拿
  return out;
}
