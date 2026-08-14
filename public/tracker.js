(function () {
  'use strict';

  // Guard contra dupla inicialização (ex: SPA re-render)
  if (window.__tp_initialized) return;
  window.__tp_initialized = true;

  // ── Config via atributos do <script> tag ──────────────────────────────────
  var SCRIPT_TAG  = document.currentScript;
  var PIXEL_ID    = SCRIPT_TAG ? SCRIPT_TAG.getAttribute('data-pixel-id') : null;
  var GA4_ID      = SCRIPT_TAG ? SCRIPT_TAG.getAttribute('data-ga4-id')   : null;
  var API_BASE    = (function() {
    if (SCRIPT_TAG) {
      var attr = SCRIPT_TAG.getAttribute('data-api-base');
      if (attr) return attr.replace(/\/$/, '');
      var src = SCRIPT_TAG.src;
      if (src) {
        var m = src.match(/^(https?:\/\/[^\/]+)/);
        if (m) return m[1];
      }
    }
    return '';
  })();
  var COOKIE_NAME = 'tp_uid';
  var COOKIE_DAYS = 90;
  var HOTMART_RE  = /pay\.hotmart\.com|checkout\.hotmart\.com/i;
  var SESSION_KEY = 'tp_pv_' + window.location.pathname;

  // ── Utilidades ────────────────────────────────────────────────────────────
  function uuid4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  // Identificador persistente do usuário.
  // Estratégia (resolve ITP do Safari/Brave que capa cookies client-set em 7 dias):
  //   1. Lê cookie tp_uid (rápido).
  //   2. Se não houver, lê localStorage como fallback (sobrevive a JS-cookie expirar).
  //   3. Chama GET /api/uid (server-set cookie, não sofre cap do ITP, dura ~400 dias).
  //      Se temos um uid de localStorage, manda como ?uid=... pra recuperar o mesmo id.
  //   4. Espelha sempre em localStorage.
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function getOrCreateUserId() {
    var cookieUid = getCookie(COOKIE_NAME);
    if (cookieUid) { lsSet(COOKIE_NAME, cookieUid); return Promise.resolve(cookieUid); }

    var lsUid = lsGet(COOKIE_NAME);
    var url = API_BASE + '/api/uid' + (lsUid ? '?uid=' + encodeURIComponent(lsUid) : '');
    return fetch(url, { credentials: 'include' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var uid = (j && j.user_id) || lsUid || uuid4();
        lsSet(COOKIE_NAME, uid);
        // Fallback extra: se /api/uid falhou em setar o cookie (ex: domínio errado), seta no client
        if (!getCookie(COOKIE_NAME)) setCookie(COOKIE_NAME, uid, COOKIE_DAYS);
        return uid;
      })
      .catch(function () {
        var uid = lsUid || uuid4();
        lsSet(COOKIE_NAME, uid);
        setCookie(COOKIE_NAME, uid, COOKIE_DAYS);
        return uid;
      });
  }

  // ── UTM persistence: URL → cookie → referrer ───────────────────────────
  var UTM_COOKIE = 'tp_utms';
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  function getUtmsFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var utms = {};
    var hasAny = false;
    UTM_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) { utms[k] = v; hasAny = true; }
    });
    return hasAny ? utms : null;
  }

  function getUtmsFromCookie() {
    var raw = getCookie(UTM_COOKIE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function getUtmsFromReferrer() {
    var ref = document.referrer;
    if (!ref) return null;
    try {
      var url = new URL(ref);
      // Se referrer é do mesmo domínio, ignorar
      if (url.hostname === window.location.hostname) return null;
      return { utm_source: url.hostname, utm_medium: 'referral' };
    } catch (e) { return null; }
  }

  function saveUtmsCookie(utms) {
    setCookie(UTM_COOKIE, JSON.stringify(utms), 30);
  }

  function getUrlParams() {
    var params = new URLSearchParams(window.location.search);
    // Cadeia de fallback: URL → cookie → referrer
    var utms = getUtmsFromUrl() || getUtmsFromCookie() || getUtmsFromReferrer() || {};
    // Persistir UTMs em cookie para páginas seguintes
    if (getUtmsFromUrl()) saveUtmsCookie(getUtmsFromUrl());
    return {
      utm_source:   utms.utm_source || null,
      utm_medium:   utms.utm_medium || null,
      utm_campaign: utms.utm_campaign || null,
      utm_term:     utms.utm_term || null,
      utm_content:  utms.utm_content || null,
      fbclid:       params.get('fbclid'),
    };
  }

  // ── GA4 cookies (gtag.js) ─────────────────────────────────────────────────
  // _ga formato: GA1.2.{part1}.{part2} → client_id = "{part1}.{part2}"
  function getGaClientId() {
    var raw = getCookie('_ga');
    if (!raw) return null;
    var parts = raw.split('.');
    if (parts.length < 4) return null;
    return parts[2] + '.' + parts[3];
  }
  // _ga_<measurementIdSuffix> formato:
  //   GS1.1.{session_id_ts}.{session_number}.{is_active}.{...}
  function getGaSession(measurementId) {
    if (!measurementId) return { session_id: null, session_number: null };
    var suffix = measurementId.replace(/^G-/, '');
    var raw = getCookie('_ga_' + suffix);
    if (!raw) return { session_id: null, session_number: null };
    var parts = raw.split('.');
    if (parts.length < 4) return { session_id: null, session_number: null };
    return { session_id: parts[2], session_number: parts[3] };
  }
  function getGaIds() {
    var session = getGaSession(GA4_ID);
    return {
      ga_client_id:      getGaClientId(),
      ga_session_id:     session.session_id,
      ga_session_number: session.session_number,
    };
  }

  // CRÍTICO: Ler _fbp e _fbc FRESH a cada envio.
  // Meta Pixel seta _fbp de forma assíncrona. Se cachear na init, pode enviar null.
  function getFreshFbCookies(fbclid) {
    var fbp = getCookie('_fbp');
    var fbc = getCookie('_fbc');
    // Se tem fbclid mas não tem _fbc, criar manualmente (Meta docs: fb.1.{timestamp}.{fbclid})
    if (!fbc && fbclid) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      setCookie('_fbc', fbc, 90);
    }
    return { fbp: fbp, fbc: fbc };
  }

  // Espera o Meta Pixel (fbevents.js) setar _fbp — e, se há fbclid, _fbc.
  // Substitui o antigo setTimeout(1500) fixo, que perdia ~11% dos eventos em
  // conexões lentas (fbevents.js demora mais que 1.5s pra carregar). Dispara o
  // callback assim que os cookies aparecem (~200-500ms em rede normal) ou ao
  // bater MAX_WAIT_MS — preserva o evento mesmo no pior cenário.
  function waitForFbCookies(fbclid, callback) {
    var MAX_WAIT_MS = 5000;
    var POLL_INTERVAL_MS = 100;
    var start = Date.now();
    var wantsFbc = !!fbclid;
    function check() {
      var fbp = getCookie('_fbp');
      var fbc = getCookie('_fbc');
      var ready = fbp && (!wantsFbc || fbc);
      if (ready || (Date.now() - start) >= MAX_WAIT_MS) { callback(); return; }
      setTimeout(check, POLL_INTERVAL_MS);
    }
    check();
  }

  // ── Meta Pixel SDK Loader ────────────────────────────────────────────────
  function loadMetaPixel(pixelId) {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s){
      if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)
    }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', pixelId);
  }

  // ── GA4 (gtag.js) Loader ─────────────────────────────────────────────────
  // Client-side é mandatório porque o GA4 Measurement Protocol não suporta
  // ip_override — eventos do server perdem a geo. Aqui o gtag pega IP do
  // browser e resolve geo, channel grouping, gclid, device etc. nativamente.
  // send_page_view: false → disparamos manual em initWithUid pra incluir UTMs.
  function loadGtag(measurementId, userId) {
    if (window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    var config = { send_page_view: false };
    if (userId) config.user_id = userId;
    gtag('config', measurementId, config);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(measurementId);
    var first = document.getElementsByTagName('script')[0];
    first.parentNode.insertBefore(s, first);
  }

  // ── Envio de evento server-side (CAPI) ────────────────────────────────────
  // O mesmo event_id é usado no fbq() e no POST /api/event → Meta deduplica
  function postEvent(eventName, userId, pixelId, utms, fbclid, eventId) {
    var fb = getFreshFbCookies(fbclid);
    var ga = getGaIds();
    var payload = {
      event_name: eventName, event_id: eventId || uuid4(),
      user_id: userId, pixel_id: pixelId,
      user_agent: navigator.userAgent, page_url: window.location.href,
      page_referrer: document.referrer || null,
      utm_source: utms.utm_source, utm_medium: utms.utm_medium,
      utm_campaign: utms.utm_campaign, utm_term: utms.utm_term,
      utm_content: utms.utm_content,
      fbp: fb.fbp, fbc: fb.fbc,
      ga_client_id: ga.ga_client_id, ga_session_id: ga.ga_session_id,
      ga_session_number: ga.ga_session_number,
    };
    // keepalive: true garante que o request completa mesmo durante navegação
    fetch(API_BASE + '/api/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), keepalive: true,
    })
      .then(function (r) {
        if (!r.ok) console.warn('[Tracker] /api/event HTTP', r.status, eventName);
      })
      .catch(function (e) { console.warn('[Tracker] /api/event error', e); });
  }

  // ── Captura de lead (perfil persistente no banco) ─────────────────────────
  function postLead(userId, pixelId, utms, fbclid) {
    var fb = getFreshFbCookies(fbclid);
    var ga = getGaIds();
    var payload = {
      user_id: userId, pixel_id: pixelId,
      user_agent: navigator.userAgent, url: window.location.href,
      page_referrer: document.referrer || null,
      utm_source: utms.utm_source, utm_medium: utms.utm_medium,
      utm_campaign: utms.utm_campaign, utm_term: utms.utm_term,
      utm_content: utms.utm_content,
      fbp: fb.fbp, fbc: fb.fbc,
      ga_client_id: ga.ga_client_id, ga_session_id: ga.ga_session_id,
      ga_session_number: ga.ga_session_number,
    };
    return fetch(API_BASE + '/api/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), keepalive: true,
    })
      .then(function (r) {
        if (!r.ok) console.warn('[Tracker] /api/lead HTTP', r.status);
      })
      .catch(function (e) { console.warn('[Tracker] /api/lead error', e); });
  }

  // ── Decoração de URL do Hotmart com dados de tracking ─────────────────────
  // xcod = user_id (usado no webhook para lead matching)
  // src e sck = source|campaign|medium|content|term (todas as 5 UTMs ou referrer)
  function decorateHotmartUrl(href, userId, utms) {
    try {
      var url = new URL(href);

      // Todas as 5 UTMs na mesma ordem, fallback para referrer no source
      var source   = utms.utm_source || document.referrer || '';
      var campaign = utms.utm_campaign || '';
      var medium   = utms.utm_medium || '';
      var content  = utms.utm_content || '';
      var term     = utms.utm_term || '';

      var allUtms = [source, campaign, medium, content, term].join('|');

      if (allUtms.replace(/\|/g, '')) {
        url.searchParams.set('src', allUtms);
        url.searchParams.set('sck', allUtms);
      }

      url.searchParams.set('xcod', userId);
      return url.toString();
    } catch (e) { return href; }
  }

  // ── Interceptor de cliques em links do Hotmart ────────────────────────────
  function attachHotmartInterceptors(userId, pixelId, utms) {
    var fbclid = utms.fbclid;
    var checkoutLock = false;
    document.addEventListener('click', function (e) {
      var el = e.target.closest('a[href]');
      if (!el) return;
      var href = el.getAttribute('href') || '';
      if (!HOTMART_RE.test(href)) return;

      e.preventDefault();

      // Dedup: ignora cliques repetidos (double-click, click duplo do usuário)
      // enquanto o redirect ainda não aconteceu
      if (checkoutLock) return;
      checkoutLock = true;
      // Libera após 3s caso o redirect falhe (segurança)
      setTimeout(function () { checkoutLock = false; }, 3000);

      var eventId = uuid4();
      var decoratedUrl = decorateHotmartUrl(href, userId, utms);

      // Dispara pixel client-side com mesmo eventID → Meta deduplica com CAPI
      if (window.fbq) fbq('track', 'InitiateCheckout', {}, { eventID: eventId });
      // GA4: nome reservado e-commerce
      if (window.gtag) gtag('event', 'begin_checkout', {});

      var redirected = false;
      function redirect() { if (!redirected) { redirected = true; window.location.href = decoratedUrl; } }

      // Envia lead + evento em paralelo, depois redireciona
      Promise.all([
        postLead(userId, pixelId, utms, fbclid),
        postEvent('InitiateCheckout', userId, pixelId, utms, fbclid, eventId),
      ]).finally(redirect);

      // Fallback: redireciona após 600ms mesmo se requests não completarem
      setTimeout(redirect, 600);
    }, true);
  }

  // ── Inicialização ─────────────────────────────────────────────────────────
  function init() {
    if (!PIXEL_ID) { console.warn('[Tracker] Missing data-pixel-id'); return; }
    getOrCreateUserId().then(function (userId) { initWithUid(userId); });
  }

  function initWithUid(userId) {
    var utms = getUrlParams();
    var pageViewId = uuid4();

    // Carrega Meta Pixel SDK PRIMEIRO
    loadMetaPixel(PIXEL_ID);
    if (GA4_ID) loadGtag(GA4_ID, userId);

    // PageView dispara assim que o Meta Pixel setar _fbp (e _fbc se houver fbclid).
    // Sem cookies prontos, o evento iria pro CAPI com fbp/fbc null e perderia EMQ.
    var pageViewSent = false;
    function firePageView() {
      if (pageViewSent) return;
      pageViewSent = true;
      // Pixel client-side com eventID para dedup com CAPI
      if (window.fbq) fbq('track', 'PageView', {}, { eventID: pageViewId });
      // CAPI server-side com mesmo eventID
      postEvent('PageView', userId, PIXEL_ID, utms, utms.fbclid, pageViewId);
      // GA4 — UTMs como params reservados (source/medium/campaign/term/content)
      // alimentam o Channel Grouping nativo do GA4
      if (window.gtag) gtag('event', 'page_view', {
        page_location: window.location.href,
        page_title: document.title,
        page_referrer: document.referrer || undefined,
        source:   utms.utm_source   || undefined,
        medium:   utms.utm_medium   || undefined,
        campaign: utms.utm_campaign || undefined,
        term:     utms.utm_term     || undefined,
        content:  utms.utm_content  || undefined,
      });
    }

    waitForFbCookies(utms.fbclid, firePageView);

    // Se a aba ficar oculta antes do polling completar, força o envio com o
    // que tem — evita perder o evento se o usuário fecha a aba rapidamente.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') firePageView();
    });

    attachHotmartInterceptors(userId, PIXEL_ID, utms);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
