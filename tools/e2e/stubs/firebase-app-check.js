// 測試用的假 App Check：什麼都不做
export function initializeAppCheck() { return {}; }
export class ReCaptchaEnterpriseProvider { constructor(key) { this.key = key; } }
export async function getToken() { (window.__fb.log || (window.__fb.log = [])).push(['appCheckToken', 'refresh']); return { token: 'ac' }; }
