const S = (window.__fb = window.__fb || {});
S.authCbs = S.authCbs || [];
const auth = { currentUser: null };
S.setUser = (email) => {
  auth.currentUser = email ? { email, getIdToken: async () => 'tok-' + email } : null;
  S.authCbs.forEach((cb) => cb(auth.currentUser));
};
export function getAuth() { S.log = S.log || []; S.log.push(['getAuth']); return auth; }
export class GoogleAuthProvider {}
export async function signInWithPopup() { S.setUser(S.popupEmail || 'teacher@example.com'); }
export async function signOut() { S.setUser(null); }
export function onAuthStateChanged(_auth, cb) {
  S.authCbs.push(cb);
  setTimeout(() => cb(auth.currentUser), 10);
  return () => { S.authCbs = S.authCbs.filter((x) => x !== cb); };
}
