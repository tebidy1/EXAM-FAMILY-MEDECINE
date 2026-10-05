/* ============================================================
   Track — the steps a visitor takes before the account exists.

   public.events only accepts rows from a signed-in user, so until this
   file everyone who opened the app and left was invisible. This records
   the way in: the landing page, the button, the form, the refusal and
   its reason, the install, the first question.

   What it sends: a random id kept in this browser, the step, the kind of
   device, and the hostname that linked here. No name, no email, no IP,
   no tracking cookie. It never throws and never delays a screen: a step
   that cannot be sent is simply lost.
   ============================================================ */
'use strict';

window.Track = (function () {
  const cfg = window.SB_CONFIG || {};
  const on = !!(cfg.url && cfg.anonKey);
  const VID_KEY = 'oman-em-prep.vid';

  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const device = ios ? 'iphone' : android ? 'android' : /Windows|Macintosh|Linux|CrOS/i.test(ua) ? 'desktop' : 'other';

  // a link opened inside a social app lands in its built-in browser, which can
  // neither install the app nor carry a session out of itself: worth counting
  const hit = /(FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Bytedance|Snapchat|Twitter|LinkedInApp|Line\/)/i.exec(ua);
  const inApp = hit ? ({ fban: 'Facebook', fbav: 'Facebook', fb_iab: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', musical_ly: 'TikTok', bytedance: 'TikTok', snapchat: 'Snapchat', twitter: 'X', linkedinapp: 'LinkedIn', 'line/': 'LINE' })[hit[1].toLowerCase()] : null;

  const standalone = (() => {
    try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
  })();

  // the same id on the landing page and in the app (one origin, one store), so
  // the two halves of the funnel join up. On iPhone the installed app keeps its
  // own storage and mints a new one — that break is what `standalone` marks.
  const vid = (() => {
    try {
      let v = localStorage.getItem(VID_KEY);
      if (!/^[0-9a-f-]{36}$/i.test(v || '')) {
        v = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        localStorage.setItem(VID_KEY, v);
      }
      return v;
    } catch (e) { return null; }   // private mode: no id, nothing is sent
  })();

  // only the host that linked here, never the full address
  const from = (() => {
    try {
      const r = document.referrer;
      if (!r) return '';
      const h = new URL(r).hostname;
      return h === location.hostname ? '' : h;
    } catch (e) { return ''; }
  })();

  const seen = new Set();

  function step(name, meta, dedupe = false) {
    try {
      if (!on || !vid) return;
      if (dedupe) {
        if (seen.has(name)) return;
        seen.add(name);
      }
      const body = {
        vid, step: name, device, in_app: inApp, standalone,
        user_id: (window.SB && SB.session && SB.session.user && SB.session.user.id) || null,
        meta: { ...(from ? { from } : {}), ...(meta || {}) },
      };
      fetch(cfg.url + '/rest/v1/visits', {
        method: 'POST',
        headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(body),
        keepalive: true,        // the step still leaves while the page is being left
      }).catch(() => {});
    } catch (e) { /* analytics never breaks a screen */ }
  }

  return { step, get vid() { return vid; }, device, inApp, standalone };
})();
