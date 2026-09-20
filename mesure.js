/* Mesure d'audience ose-os.fr (v2) — sans cookie, exemptée de consentement (CNIL).
 *
 * Envoie des lots d'événements au relais Cloudflare (stats-relais/) : arrivée,
 * sections vues, démos regardées, paliers de scroll, clics, formulaire, départ.
 * Le reste du site signale ses actions via window.oseStat(type, données) ; un
 * tampon défini dans le <head> garde les appels faits avant ce fichier.
 * Opposition : ?nostats=1, bouton de confidentialite.html, ou signal GPC.
 * Tout est protégé : la mesure ne doit jamais casser le site.
 */
(function () {
  'use strict';
  var URL_RELAIS = 'https://ose-stats.stats-relais.workers.dev/e';
  var VISITE_MS = 30 * 60 * 1000;             // visite = 30 min d'inactivité
  var VISITEUR_MS = 395 * 24 * 3600 * 1000;   // identifiant : 13 mois, sans prolongation
  var MAX_LOT = 20;
  var INACTIVITE_MS = 2 * 60 * 1000;   // au-delà, les démos qui défilent seules ne comptent plus
  var MAX_DEMOS_PAR_PAGE = 40;         // plafond d'événements « demo » par chargement de page
  var ls;

  function refuse() {
    try {
      return ls.getItem('ose_nostats') === '1' || navigator.globalPrivacyControl === true;
    } catch (e) {
      return true;
    }
  }

  function lireJson(cle) {
    try { return JSON.parse(ls.getItem(cle) || 'null'); } catch (e) { return null; }
  }

  function hasard() {
    var octets = new Uint8Array(8);
    crypto.getRandomValues(octets);
    return Array.prototype.map.call(octets, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  try {
    ls = window.localStorage;
    var params = new URLSearchParams(location.search);
    if (params.get('nostats') === '1') ls.setItem('ose_nostats', '1');
    if (params.get('moi') === '1') ls.setItem('ose_moi', '1');
    if (refuse()) {
      ls.removeItem('ose_vis');
      ls.removeItem('ose_visite');
      window.oseStat = function () {};
      return;
    }

    // ── Identifiants anonymes ──
    var t0 = Date.now();
    var visiteur = lireJson('ose_vis');
    if (!visiteur || !visiteur.id || t0 - visiteur.cree > VISITEUR_MS) {
      visiteur = { id: hasard(), cree: t0, n: 0 };
    }
    var visite = lireJson('ose_visite');
    if (!visite || !visite.id || t0 - visite.dernier > VISITE_MS) {
      visite = { id: hasard(), dernier: t0 };
      visiteur.n += 1;
    }
    if (!visiteur.n) visiteur.n = 1;
    ls.setItem('ose_vis', JSON.stringify(visiteur));
    var moi = ls.getItem('ose_moi') === '1';

    // ── Activité réelle du visiteur (pointeur, clavier, molette, scroll, retour sur l'onglet) ──
    // Le carrousel de démos défile tout seul : sans activité récente, ses changements ne
    // doivent ni créer d'événements ni prolonger la visite.
    var derniereActivite = t0;
    function activite() { derniereActivite = Date.now(); }
    function actifRecemment() { return Date.now() - derniereActivite <= INACTIVITE_MS; }
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (type) {
      window.addEventListener(type, activite, { passive: true, capture: true });
    });

    function toucher() {
      visite.dernier = Date.now();
      try { ls.setItem('ose_visite', JSON.stringify(visite)); } catch (e) {}
    }
    toucher();

    // ── File d'envoi ──
    var file = [];
    function ev(type, donnees, ts) {
      file.push({ t: type, ts: ts || Date.now(), d: donnees || {} });
    }
    function envoyer() {
      if (refuse()) { file = []; return; }
      var envoye = false;
      while (file.length) {
        var corps = JSON.stringify({
          v: 1, visiteur: visiteur.id, visite: visite.id, page: location.pathname,
          moi: moi ? 1 : 0, envoi: Date.now(), ev: file.splice(0, MAX_LOT),
        });
        try {
          var parti = navigator.sendBeacon &&
            navigator.sendBeacon(URL_RELAIS, new Blob([corps], { type: 'text/plain;charset=UTF-8' }));
          if (!parti) {
            fetch(URL_RELAIS, {
              method: 'POST', body: corps, keepalive: true, mode: 'cors',
              headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            }).catch(function () {});
          }
        } catch (e) {}
        envoye = true;
      }
      if (envoye && actifRecemment()) toucher();
    }
    setInterval(envoyer, 5000);

    // ── Visite expirée dans un onglet resté ouvert (> 30 min sans activité) ──
    // Appelé sur une activité réelle (retour sur l'onglet, scroll, clic). Les événements
    // en attente partent sous l'ancienne visite ; si un autre onglet a déjà ouvert une
    // nouvelle visite, on la rejoint, sinon on en crée une (n + 1) avec une nouvelle arrivée.
    function renouvelerSiExpiree() {
      if (refuse()) return;
      if (Date.now() - visite.dernier <= VISITE_MS) return;
      var partagee = lireJson('ose_visite');
      var stocke = lireJson('ose_vis');
      envoyer();
      var maintenant = Date.now();
      if (stocke && stocke.id === visiteur.id && stocke.n > visiteur.n) visiteur.n = stocke.n;
      if (partagee && partagee.id && partagee.id !== visite.id && maintenant - partagee.dernier <= VISITE_MS) {
        visite = partagee;
      } else {
        visite = { id: hasard(), dernier: maintenant };
        visiteur.n += 1;
      }
      try {
        ls.setItem('ose_vis', JSON.stringify(visiteur));
        ls.setItem('ose_visite', JSON.stringify(visite));
      } catch (e) {}
      paliers = {};
      scrollMax = 0;
      actifMs = 0;
      departEnvoye = false;
      if (document.visibilityState === 'visible') visibleDepuis = maintenant;
      file.unshift({ t: 'arrivee', ts: maintenant, d: {
        ref: '', ecran: window.innerWidth + 'x' + window.innerHeight,
        lang: navigator.language || '', nouveau: visiteur.n === 1, n: visiteur.n,
      } });
      envoyer();
    }

    // ── Temps actif (onglet visible) ──
    var actifMs = 0;
    var visibleDepuis = document.visibilityState === 'visible' ? t0 : null;

    // ── Scroll ──
    var scrollMax = 0, paliers = {}, rafScroll = 0;
    function mesurerScroll() {
      rafScroll = 0;
      renouvelerSiExpiree();
      var hauteur = document.documentElement.scrollHeight - window.innerHeight;
      var pct = hauteur > 0 ? Math.min(100, Math.round((100 * window.scrollY) / hauteur)) : 100;
      if (pct > scrollMax) scrollMax = pct;
      [25, 50, 75, 100].forEach(function (p) {
        if (pct >= p && !paliers[p]) { paliers[p] = 1; ev('scroll', { palier: p }); }
      });
    }
    window.addEventListener('scroll', function () {
      activite();
      if (!rafScroll) rafScroll = requestAnimationFrame(mesurerScroll);
    }, { passive: true });

    // ── Sections (≥ 50 % de la section ou de l'écran, pendant ≥ 1 s) ──
    var enVue = {}, visibles = {};
    function ouvrirSection(id) {
      if (enVue[id] == null && document.visibilityState === 'visible') enVue[id] = Date.now();
    }
    function fermerSection(id) {
      if (enVue[id] == null) return;
      var duree = Date.now() - enVue[id];
      delete enVue[id];
      if (duree >= 1000) ev('section', { id: id, duree_ms: duree });
    }
    if ('IntersectionObserver' in window) {
      var obsSections = new IntersectionObserver(function (entrees) {
        entrees.forEach(function (e) {
          var id = e.target.getAttribute('data-stat-section');
          var visible = e.isIntersecting &&
            (e.intersectionRatio >= 0.5 || e.intersectionRect.height >= window.innerHeight * 0.5);
          visibles[id] = visible;
          if (visible) ouvrirSection(id); else fermerSection(id);
        });
      }, { threshold: [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1] });
      ['hero', 'apropos', 'services', 'process', 'infos', 'essayez'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.setAttribute('data-stat-section', id); obsSections.observe(el); }
      });
      var pied = document.querySelector('footer');
      if (pied) { pied.setAttribute('data-stat-section', 'footer'); obsSections.observe(pied); }
    }

    // ── Démos du téléphone (compte si onglet visible ET téléphone ≥ 50 % visible) ──
    var demo = null, demoCourante = null, telephoneVisible = false, demosEnvoyees = 0;
    function demoCompte() { return document.visibilityState === 'visible' && telephoneVisible; }
    function demoPause() {
      if (demo && demo.depuis) { demo.cumul += Date.now() - demo.depuis; demo.depuis = null; }
    }
    function demoReprise() {
      if (demo && !demo.depuis && demoCompte()) demo.depuis = Date.now();
    }
    function demoFermer() {
      if (!demo) return;
      demoPause();
      if (demo.cumul >= 500 && (demo.manuel || actifRecemment()) && demosEnvoyees < MAX_DEMOS_PAR_PAGE) {
        demosEnvoyees += 1;
        ev('demo', { k: demo.k, nom: demo.nom, duree_ms: demo.cumul, manuel: demo.manuel });
      }
      demo = null;
    }
    function demoOuvrir(d) {
      demoCourante = d;
      demo = { k: d.k, nom: d.nom || '', manuel: !!d.manuel, cumul: 0, depuis: null };
      demoReprise();
    }
    var vitrine = document.getElementById('showcase');
    if (vitrine && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entrees) {
        telephoneVisible = entrees[entrees.length - 1].intersectionRatio >= 0.5;
        if (telephoneVisible) demoReprise(); else demoPause();
      }, { threshold: [0, 0.5, 1] }).observe(vitrine);
    }

    // ── Appels du site (window.oseStat) ──
    function traiter(type, donnees, ts) {
      if (type === 'demo_actif') { demoFermer(); demoOuvrir(donnees); return; }
      ev(type, donnees, ts);
      if (type === 'form' || type === 'essai') envoyer();
    }
    var enAttente = (window.oseStat && window.oseStat.q) || [];
    window.oseStat = function (type, donnees) {
      try { traiter(type, donnees || {}); } catch (e) {}
    };
    enAttente.forEach(function (appel) {
      try { traiter(appel[0], appel[1] || {}, appel[2]); } catch (e) {}
    });

    // ── Clics sur les éléments data-stat ──
    document.addEventListener('click', function (e) {
      activite();
      var el = e.target && e.target.closest ? e.target.closest('[data-stat]') : null;
      if (el) { renouvelerSiExpiree(); ev('clic', { cible: el.getAttribute('data-stat') }); envoyer(); }
    }, true);

    // ── Départ / retour sur l'onglet ──
    var departEnvoye = false;
    function depart() {
      Object.keys(enVue).forEach(fermerSection);
      demoFermer();
      if (visibleDepuis) { actifMs += Date.now() - visibleDepuis; visibleDepuis = null; }
      if (!departEnvoye) { ev('depart', { actif_ms: actifMs, scroll_max: scrollMax }); departEnvoye = true; }
      envoyer();
    }
    function retour() {
      activite();
      renouvelerSiExpiree();
      departEnvoye = false;
      visibleDepuis = Date.now();
      Object.keys(visibles).forEach(function (id) { if (visibles[id]) ouvrirSection(id); });
      if (demoCourante && !demo) demoOuvrir(demoCourante);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') depart(); else retour();
    });
    window.addEventListener('pagehide', depart);

    // ── Arrivée (après le chargement, pour connaître sa durée) ──
    function chargeMs() {
      try {
        var nav = performance.getEntriesByType('navigation')[0];
        return nav ? Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd) : 0;
      } catch (e) {
        return 0;
      }
    }
    function partirArrivee() {
      var d = {
        ref: (document.referrer || '').slice(0, 300),
        ecran: window.innerWidth + 'x' + window.innerHeight,
        lang: navigator.language || '',
        nouveau: visiteur.n === 1,
        n: visiteur.n,
      };
      var charge = chargeMs();
      if (charge) d.charge_ms = charge;
      var utm = {};
      ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
        var v = params.get('utm_' + k);
        if (v) utm[k] = v.slice(0, 100);
      });
      if (Object.keys(utm).length) d.utm = utm;
      file.unshift({ t: 'arrivee', ts: t0, d: d });
      mesurerScroll();
      envoyer();
    }
    if (document.readyState === 'complete') partirArrivee();
    else window.addEventListener('load', function () { setTimeout(partirArrivee, 0); });
  } catch (e) { /* la mesure ne doit jamais casser le site */ }
})();
