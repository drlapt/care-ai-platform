// Shared Web Speech Recognition helper used by FollowupChat and ConsultationSession.
// Fixes:
//   • Duplicate transcripts ("I have I have headache headache") — cleanly separates
//     the user's pre-existing typed input from final + interim fragments.
//   • iOS Safari unreliability — uses continuous=false, single shot per click,
//     surfaces a friendly hint when the language is unsupported.
//   • Unsupported language fallback (currently te-IN / ta-IN are unsupported on
//     iOS Safari and many Android browsers) — surfaces a clear toast instead of
//     silently failing.

const SR = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export const isSpeechSupported = () => Boolean(SR);

const isIOS = () => typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const isSafari = () => typeof navigator !== "undefined" && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

// Languages that are reliably supported by browser SpeechRecognition.
// Web Speech in Chrome/Edge supports te-IN and ta-IN. iOS Safari does NOT (yet).
export const isLanguageLikelySupported = (locale) => {
  if (!locale) return true;
  if (isIOS() || isSafari()) {
    // iOS / desktop Safari only reliably handle en, hi, fr, es, de, ja, ko, zh-CN.
    return /^(en|hi|fr|es|de|ja|ko|zh)/i.test(locale);
  }
  return true; // Chrome / Edge handle te-IN and ta-IN fine
};

/**
 * Start a one-shot speech recognition session.
 *
 * @param {Object}   opts
 * @param {string}   opts.locale       BCP-47 locale (e.g. "en-US", "ta-IN")
 * @param {string}   opts.baseValue    Existing input contents BEFORE recording started — preserved verbatim
 * @param {Function} opts.onUpdate     (newValue) => void  ← called with `${baseValue} ${final} ${interim}`
 * @param {Function} opts.onError      (errorString) => void
 * @param {Function} opts.onEnd        () => void
 * @returns {{stop: () => void, recognition: SpeechRecognition} | null}
 */
export function startSpeechRecognition({ locale, baseValue = "", onUpdate, onError, onEnd } = {}) {
  if (!SR) {
    onError?.("not-supported");
    return null;
  }
  if (!isLanguageLikelySupported(locale)) {
    onError?.("language-not-supported-on-this-device");
    return null;
  }

  const rec = new SR();
  rec.continuous = false;        // one-shot — most reliable on iOS
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  if (locale) rec.lang = locale;

  // Track CUMULATIVE final transcript across this session so duplicate
  // events don't append the same chunk twice.
  let finalText = "";

  rec.onresult = (ev) => {
    let interim = "";
    let newFinal = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) newFinal += t;
      else interim += t;
    }
    if (newFinal) finalText = (finalText + " " + newFinal).replace(/\s+/g, " ").trim();
    const pieces = [baseValue, finalText, interim].map((s) => (s || "").trim()).filter(Boolean);
    onUpdate?.(pieces.join(" ").replace(/\s+/g, " "));
  };

  rec.onerror = (ev) => {
    if (ev.error && ev.error !== "no-speech" && ev.error !== "aborted") onError?.(ev.error);
  };

  rec.onend = () => {
    onEnd?.();
  };

  try {
    rec.start();
  } catch (e) {
    onError?.(`start-failed: ${e?.message || e}`);
    return null;
  }

  return {
    recognition: rec,
    stop() { try { rec.stop(); } catch { /* noop */ } },
  };
}

export function speechSupportNote(locale) {
  if (!SR) return "Voice input isn't available in this browser. Try Chrome/Edge on desktop or Safari on iOS.";
  if (!isLanguageLikelySupported(locale)) {
    return "Voice input for this language isn't supported on iOS/Safari yet — try Chrome on Android or desktop, or type your message.";
  }
  return null;
}
