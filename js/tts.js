const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const ttsSupported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

let voice = null;
function pickVoice() {
  if (!ttsSupported) return;
  const voices = synth.getVoices();
  voice = voices.find((v) => /en-US/i.test(v.lang) && /Google|Samantha|Microsoft/i.test(v.name))
    || voices.find((v) => /^en/i.test(v.lang)) || null;
}
if (ttsSupported) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}

export function speak(text, rate = 0.9) {
  if (!ttsSupported || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  if (voice) u.voice = voice;
  synth.speak(u);
}
