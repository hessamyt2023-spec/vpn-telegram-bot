/*
 * Thin wrapper over the browser's Web Speech API (SpeechRecognition).
 * Keeps listening until stop() — Chrome ends a session after silence or
 * about a minute, so the wrapper reopens it while the user still wants the mic on.
 */
(function (root) {
  'use strict';

  const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const isAndroid = /Android/i.test((root.navigator && root.navigator.userAgent) || '');

  const MESSAGES = {
    'not-allowed': 'اجازهٔ میکروفون داده نشد. از نماد قفل کنار نوار آدرس، دسترسی میکروفون را برای این صفحه روشن کنید.',
    'service-not-allowed': 'این مرورگر یا این صفحه اجازهٔ تشخیص گفتار ندارد. صفحه را با HTTPS یا localhost در Chrome یا Edge باز کنید.',
    'audio-capture': 'میکروفونی پیدا نشد. اتصال میکروفون را بررسی کنید.',
    'network': 'سرویس تشخیص گفتار در دسترس نیست. Chrome برای فارسی از سرور گوگل استفاده می‌کند؛ اتصال اینترنت را بررسی کنید (در بعضی شبکه‌ها این سرویس مسدود است).',
    'language-not-supported': 'این مرورگر تشخیص گفتار فارسی ندارد. Chrome یا Edge را امتحان کنید.',
    'bad-grammar': 'خطای داخلی تشخیص گفتار.',
    'unsupported': 'این مرورگر تشخیص گفتار ندارد. Chrome یا Edge (دسکتاپ یا اندروید) را امتحان کنید، یا در کادر فرمان متنی با میکروفون کیبورد صحبت کنید.',
  };

  class VoiceInput {
    constructor(handlers) {
      this.h = handlers || {};
      this.lang = 'fa-IR';
      this.wanted = false;
      this.rec = null;
      this.networkRetries = 0;
    }

    static get supported() {
      return !!Recognition;
    }

    get listening() {
      return this.wanted;
    }

    start(lang) {
      if (lang) this.lang = lang;
      if (!Recognition) {
        this._fail('unsupported');
        return;
      }
      this.wanted = true;
      this.networkRetries = 0;
      if (!this.rec) this._open();
    }

    stop() {
      this.wanted = false;
      if (this.rec) {
        try { this.rec.stop(); } catch (e) { /* already stopped */ }
      } else {
        this._state('idle');
      }
    }

    setLang(lang) {
      this.lang = lang;
      // Reopen with the new language; onend sees wanted=true and restarts.
      if (this.rec) {
        try { this.rec.abort(); } catch (e) { /* ignore */ }
      }
    }

    _state(s) {
      if (this.h.onState) this.h.onState(s);
    }

    _fail(code) {
      this.wanted = false;
      if (this.h.onError) this.h.onError(code, MESSAGES[code] || 'خطای تشخیص گفتار: ' + code);
      this._state('idle');
    }

    _open() {
      const rec = new Recognition();
      rec.lang = this.lang;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      // Android Chrome repeats earlier text in continuous mode; one phrase per session there.
      rec.continuous = !isAndroid;

      rec.onstart = () => this._state('listening');
      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript.trim();
          if (result.isFinal) {
            if (text && this.h.onFinal) this.h.onFinal(text);
          } else {
            interim += result[0].transcript;
          }
        }
        if (this.h.onInterim) this.h.onInterim(interim.trim());
        this.networkRetries = 0;
      };
      rec.onerror = (event) => {
        const code = event.error;
        if (code === 'no-speech' || code === 'aborted') return;
        if (code === 'network' && this.networkRetries < 2) {
          this.networkRetries++;
          return; // onend reopens
        }
        this.wanted = false;
        this._fail(code);
      };
      rec.onend = () => {
        this.rec = null;
        if (this.h.onInterim) this.h.onInterim('');
        if (this.wanted) {
          const delay = this.networkRetries ? 800 * this.networkRetries : 150;
          setTimeout(() => {
            if (this.wanted && !this.rec) this._open();
          }, delay);
        } else {
          this._state('idle');
        }
      };

      this.rec = rec;
      try {
        rec.start();
      } catch (e) {
        this.rec = null;
        this._fail('not-allowed');
      }
    }
  }

  root.VoiceInput = VoiceInput;
})(typeof globalThis !== 'undefined' ? globalThis : this);
