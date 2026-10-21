/* Phone Assist demo: reads scripted lines aloud with the browser's built-in
   speech synthesis (Chrome, Edge, Safari). Two distinct voices, no vendor. */
(function (global) {
  'use strict';
  const synth = global.speechSynthesis;
  const supported = !!synth && typeof global.SpeechSynthesisUtterance === 'function';
  let voices = [];
  const keep = [];           // Chrome drops onend if the utterance is garbage collected

  function loadVoices() { if (supported) voices = synth.getVoices() || []; }
  if (supported) {
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }

  const PREF = {
    caller: ['Google UK English Female', 'Karen', 'Moira', 'Tessa', 'Microsoft Zira', 'Microsoft Sonia', 'Samantha', 'Google US English'],
    agent: ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Ava', 'Allison', 'Microsoft Zira', 'Google UK English Female']
  };

  function pick(role) {
    if (!voices.length) loadVoices();
    const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
    const pool = en.length ? en : voices;
    if (!pool.length) return null;
    const find = (names) => { for (const n of names) { const v = pool.find((x) => x.name.includes(n)); if (v) return v; } return null; };
    let v = find(PREF[role] || []);
    const other = find(PREF[role === 'caller' ? 'agent' : 'caller'] || []);
    if (!v) v = role === 'caller' ? pool[0] : (pool[1] || pool[0]);
    if (other && v === other) {                       // make sure the two speakers differ when possible
      const alt = pool.find((x) => x !== other);
      if (alt) v = alt;
    }
    return v;
  }

  function speak(text, role) {
    if (!supported || !text) return Promise.resolve(false);
    return new Promise((resolve) => {
      const u = new global.SpeechSynthesisUtterance(text);
      const v = pick(role);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = role === 'caller' ? 1.0 : 1.03;
      u.pitch = role === 'caller' ? 1.08 : 0.92;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const i = keep.indexOf(u); if (i >= 0) keep.splice(i, 1);
        resolve(ok);
      };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      keep.push(u);
      synth.cancel();
      setTimeout(() => { try { synth.speak(u); } catch (e) { finish(false); } }, 60);
      setTimeout(() => { if (!done && !synth.speaking && !synth.pending) finish(false); }, 1800);   // no voice available
      setTimeout(() => finish(true), Math.min(40000, 4000 + text.length * 95));                     // never hang
    });
  }

  function cancel() { if (supported) { try { synth.cancel(); } catch (e) { /* ignore */ } } }

  global.TTS = { supported, speak, cancel, voices: () => voices };
})(window);
