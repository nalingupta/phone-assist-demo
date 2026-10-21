/* Phone Assist demo: voice input through the browser's Web Speech API.
   Works in Chrome and Edge. No audio is played back; only you speak. */
(function (global) {
  'use strict';
  const SR = global.SpeechRecognition || global.webkitSpeechRecognition;

  function createRecognizer(handlers) {
    if (!SR) return { supported: false, start() {}, stop() {}, get listening() { return false; } };
    let rec = null;
    let wanted = false;
    let restartTimer = null;

    function makeRec() {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = handlers.lang || 'en-US';
      r.maxAlternatives = 1;
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const txt = res[0].transcript;
          if (res.isFinal) {
            const t = txt.trim();
            if (t) handlers.onFinal(t);
          } else {
            interim += txt;
          }
        }
        handlers.onInterim(interim.trim());
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          wanted = false;
          handlers.onError('Microphone access was blocked. Allow the microphone for this page and try again.');
        } else if (e.error === 'audio-capture') {
          wanted = false;
          handlers.onError('No microphone was found.');
        }
        /* no-speech, network and aborted fall through to onend, which restarts while wanted. */
      };
      r.onend = () => {
        if (wanted) {
          restartTimer = setTimeout(() => {
            try { rec = makeRec(); rec.start(); } catch (err) { wanted = false; handlers.onError(String(err)); handlers.onState('stopped'); }
          }, 150);
        } else {
          handlers.onState('stopped');
        }
      };
      r.onstart = () => handlers.onState('listening');
      return r;
    }

    return {
      supported: true,
      start() {
        if (wanted) return;
        wanted = true;
        try { rec = makeRec(); rec.start(); } catch (err) { wanted = false; handlers.onError(String(err)); }
      },
      stop() {
        wanted = false;
        clearTimeout(restartTimer);
        if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
        handlers.onInterim('');
      },
      get listening() { return wanted; }
    };
  }

  global.Voice = { supported: !!SR, createRecognizer };
})(window);
