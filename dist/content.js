(function () {
  'use strict';
  window.__pollTimer = null;
  window.__bjmoonLoaded = false;

  // === Lengyeg (overlay) HTML ===
  function createOverlay() {
    if (document.getElementById('bjmoon-overlay')) return;
    var div = document.createElement('div');
    div.id = 'bjmoon-overlay';
    div.innerHTML =
      '<div class="bm-head">' +
        '<svg class="bm-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><line x1="15" y1="15" x2="20" y2="20"/></svg>' +
        '<div class="bm-true-count" id="bm-true-count">TC: 0</div>' +
      '</div>' +
      '<div class="bm-action" id="bm-action">STAND</div>' +
      '<div class="bm-cards" id="bm-cards"></div>' +
      '<div class="bm-recommend" id="bm-recommend">Bet: 1x</div>' +
      '<div class="bm-footer" id="bm-footer">BJMoon Pro • Basic Strategy + Count</div>';
    document.documentElement.appendChild(div);
    // Drag
    var head = div.querySelector('.bm-head');
    var dragging = false, offX = 0, offY = 0;
    head.addEventListener('mousedown', function(e){ dragging=true; offX=e.clientX-div.offsetLeft; offY=e.clientY-div.offsetTop; });
    document.addEventListener('mousemove', function(e){ if(!dragging)return; div.style.left=(e.clientX-offX)+'px'; div.style.top=(e.clientY-offY)+'px'; div.style.transform='none'; });
    document.addEventListener('mouseup', function(){ dragging=false; });
  }

  // === Pay prompt ===
  function showPayPrompt() {
    window.__bjmoonLoaded = false;
    chrome.storage.local.get('bjmoon_enabled', function(res){
      if (res.bjmoon_enabled === false) return; // kikapcsolt: pay prompt sem jön
      if (document.getElementById('bjmoon-pay')) return;
      var d = document.createElement('div');
      d.id = 'bjmoon-pay';
      d.innerHTML = '<h3 style="margin:0 0 10px;font-size:18px;text-align:center;">BJMoon Pro</h3><div style="border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;margin-bottom:12px;"><p style="font-size:11px;color:#a0a0a0;text-align:center;margin:0 0 8px;">Már van fiókod?</p><button id="btn-login" style="padding:10px;background:#fff;color:#000;font-weight:700;border:none;border-radius:8px;width:100%;cursor:pointer;font-size:13px;">Login</button></div><p style="font-size:11px;color:#a0a0a0;text-align:center;margin:0 0 10px;">Csomagok:</p><button id="btn-basic-m" style="padding:8px;background:#333;color:#fff;font-weight:700;border:none;border-radius:8px;width:100%;cursor:pointer;margin-bottom:6px;font-size:12px;">Basic 1 hónap — $15</button><button id="btn-basic-l" style="padding:8px;background:#444;color:#fff;font-weight:700;border:none;border-radius:8px;width:100%;cursor:pointer;margin-bottom:6px;font-size:12px;">Basic Lifetime — $80</button><button id="btn-pro-m" style="padding:8px;background:#fff;color:#000;font-weight:700;border:none;border-radius:8px;width:100%;cursor:pointer;margin-bottom:6px;font-size:12px;">Pro 1 hónap — $20 (+Counting)</button><button id="btn-pro-l" style="padding:8px;background:#22c55e;color:#fff;font-weight:700;border:none;border-radius:8px;width:100%;cursor:pointer;font-size:12px;">Pro Lifetime — $100 (+Counting)</button>';
      d.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:rgba(10,10,10,0.95);padding:20px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);font-family:Inter,-apple-system,sans-serif;color:#fff;width:260px;box-shadow:0 20px 50px rgba(0,0,0,0.8);backdrop-filter:blur(10px);';
      document.documentElement.appendChild(d);
      document.getElementById('btn-basic-m').addEventListener('click', function(e){
        e.preventDefault();
        chrome.runtime.sendMessage({action:'openPaymentPage', plan:'basic-month'}, function(){});
      });
      document.getElementById('btn-basic-l').addEventListener('click', function(e){
        e.preventDefault();
        chrome.runtime.sendMessage({action:'openPaymentPage', plan:'basic-lifetime'}, function(){});
      });
      document.getElementById('btn-pro-m').addEventListener('click', function(e){
        e.preventDefault();
        chrome.runtime.sendMessage({action:'openPaymentPage', plan:'pro-month'}, function(){});
      });
      document.getElementById('btn-pro-l').addEventListener('click', function(e){
        e.preventDefault();
        chrome.runtime.sendMessage({action:'openPaymentPage', plan:'pro-lifetime'}, function(){});
      });
      document.getElementById('btn-login').addEventListener('click', function(e){
        e.preventDefault();
        chrome.runtime.sendMessage({action:'openLoginPage'}, function(){});
      });
    });
  }

  function hidePrompt() {
    var el = document.getElementById('bjmoon-pay');
    if (el) el.remove();
    window.__bjmoonLoaded = false;
  }

  // Track cards we've already counted to avoid double counting
  var countedCards = new Set();

  // === Strat + Overlay update ===
  function updateOverlay(result) {
    createOverlay();
    var actionEl = document.getElementById('bm-action');
    var cardsEl = document.getElementById('bm-cards');
    var detailEl = document.getElementById('bm-detail');
    if (!actionEl) return;
    actionEl.textContent = result && result.action ? result.action : '--';
    actionEl.style.color = result && result.color ? result.color : '#fff';
    if (cardsEl) {
      cardsEl.innerHTML = '';
      if (result && result.hand && result.hand.cards) {
        result.hand.cards.forEach(function(c){
          var chip = document.createElement('span');
          chip.className = 'bm-chip';
          chip.textContent = c;
          cardsEl.appendChild(chip);
        });
      }
    }
    if (detailEl) { detailEl.style.display = 'none'; detailEl.textContent = ''; }

    // === Split hands: show active / all ===
    // (data passed as param; handled externally)

    // Update true count + betting recommendation
    var tcEl = document.getElementById('bm-true-count');
    var recEl = document.getElementById('bm-recommend');
    if (tcEl && typeof BJStrategy !== 'undefined' && typeof BJStrategy.getTrueCount === 'function') {
      var tc = (typeof BJStrategy !== 'undefined' && typeof BJStrategy.getTrueCount === 'function') ? BJStrategy.getTrueCount() : (window.__bjmoonTC || 0);
      tcEl.textContent = 'TC: ' + tc;
      tcEl.style.color = tc >= 0 ? '#22c55e' : '#ef4444';
      // Bet recommendation (4 tiers based on TC)
      var bet = '1x';
      if (tc >= 2) bet = '2x';
      if (tc >= 4) bet = '4x';
      if (tc >= 6) bet = '8x';
      if (recEl) {
        recEl.textContent = 'Bet: ' + bet + (tc >= 2 ? ' • Pro' : '');
        recEl.style.color = tc >= 2 ? '#ffffff' : '#a0a0a0';
      }
    }

    // Update footer: plan + remaining days
    var footerEl = document.getElementById('bm-footer');
    if (footerEl) {
      chrome.storage.local.get(['bjmoon_sub_days', 'bjmoon_plan'], function(res){
        var days = (res && res.bjmoon_sub_days !== undefined) ? res.bjmoon_sub_days : 30;
        var planStr = (res && res.bjmoon_plan) ? res.bjmoon_plan.toString().toLowerCase() : '';
        var isPro = planStr.indexOf('pro') !== -1;
        var label = isPro ? 'Pro' : (planStr.indexOf('basic') !== -1 ? 'Basic' : '--');
        footerEl.textContent = label + ' • ' + (days > 0 ? days + ' nap' : '0 nap');
      });
    }
  }

  // === Scan stake table ===
  function scanAndShow() {
    if (typeof BJSiteConfigs === 'undefined' || typeof BJStrategy === 'undefined') return;
    var cfg = BJSiteConfigs.forHost(window.location.hostname);
    var data = null;
    if (cfg && cfg.parser) {
      try { data = cfg.parser(); } catch(e){}
    }
    if (!data && typeof BJSiteConfigs.genericParser === 'function') {
      try { data = BJSiteConfigs.genericParser(); } catch(e){}
    }
    if (!data || !data.hands || !data.hands.length) {
      // No table found — hide or show idle
      return;
    }
    // Use first active hand, or first hand
    var hand = data.hands[0];
    for (var i=0;i<data.hands.length;i++){ if(data.hands[i].active){ hand=data.hands[i]; break; } }

    // Update card counting with newly seen cards — ONLY if Pro mode
    chrome.storage.local.get('bjmoon_plan', function(p){
      var planStr = (p && p.bjmoon_plan) ? p.bjmoon_plan.toString().toLowerCase() : '';
      var isPro = planStr.indexOf('pro') !== -1;
      if (isPro && typeof BJStrategy.updateCountWithCard === 'function') {
        // Count dealer upcard
        var dealerKey = 'dealer:' + data.dealerUpcard;
        if (!countedCards.has(dealerKey)) {
          BJStrategy.updateCountWithCard(data.dealerUpcard);
          countedCards.add(dealerKey);
        }

        // Count all player cards in active hand
        hand.cards.forEach(function(card) {
          var cardKey = 'player:' + card;
          if (!countedCards.has(cardKey)) {
            BJStrategy.updateCountWithCard(card);
            countedCards.add(cardKey);
          }
        });
      }
    });

    // Get recommendation (counting-enhanced only if Pro)
    chrome.storage.local.get('bjmoon_plan', function(p){
      var planStr = (p && p.bjmoon_plan) ? p.bjmoon_plan.toString().toLowerCase() : '';
      var isPro = planStr.indexOf('pro') !== -1;
      var rec;
      if (isPro && typeof BJStrategy.getBestPlayWithCount === 'function') {
        rec = BJStrategy.getBestPlayWithCount(hand.cards, data.dealerUpcard);
      } else {
        rec = BJStrategy.getBestPlay(hand.cards, data.dealerUpcard);
      }
      updateOverlay(rec);
    });
  }

  // === Init ===
  function initApp() {
    chrome.storage.local.get('bjmoon_enabled', function(res){
      if (res.bjmoon_enabled === false) return;
      // Initialize basic strategy always
      createOverlay();
      scanAndShow();

      // === PRO GATE: counting only if plan contains 'pro' ===
      chrome.storage.local.get('bjmoon_plan', function(p){
        var plan = (p && p.bjmoon_plan) ? p.bjmoon_plan.toString().toLowerCase() : '';
        var isPro = plan.indexOf('pro') !== -1;
        if (isPro && typeof BJStrategy.initCounting === 'function') {
          BJStrategy.initCounting({decks: 6});
        }
        // If not pro, counting stays off (basic strategy only)
        countedCards.clear();
      });

      // Re-scan on mutations / interval
      if (window.__pollTimer) clearInterval(window.__pollTimer);
      window.__pollTimer = setInterval(scanAndShow, 800);
      // Also observe DOM for stake table appearance
      try {
        var obs = new MutationObserver(function(){ scanAndShow(); });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      } catch(e){}
    });
  }

  // === License check ===
  function checkLicenseAndInit() {
    window.__bjmoonLoaded = true; // jelöljük, hogy lefutott
    var responded = false;
    setTimeout(function(){
      if (!responded) {
        responded = true;
        // Timeout: ha a license check nem válaszol, nem használható
        showPayPrompt();
        return;
      }
    }, 2000);
    try {
      chrome.runtime.sendMessage({action:'checkLicense'}, function(res){
        responded = true;
        if (chrome.runtime.lastError) {
          showPayPrompt();
          // Nem bejelentkezett / hiba: overlay nem indul
          return;
        }
        if (res && res.paid) {
          hidePrompt();
          chrome.storage.local.set({ bjmoon_sub_days: 30, bjmoon_plan: (res.plan || '').toString() });
          initApp();
        } else {
          chrome.storage.local.get('bjmoon_enabled', function(set){
            if (set.bjmoon_enabled !== false) showPayPrompt();
          });
          // NEM FIZETETT: overlay és stratégia NEM indul, és ha volt, eltüntetjük
          var old = document.getElementById('bjmoon-overlay');
          if (old) old.remove();
          if (window.__pollTimer) { clearInterval(window.__pollTimer); window.__pollTimer = null; }
        }
      });
    } catch(e){
      showPayPrompt();
      // Hiba esetén sem indul az overlay (nem fizetett / nem bejelentkezett)
    }
  }

  // === Auto-refresh on license/storage changes ===
  chrome.storage.onChanged.addListener(function(changes, areaName){
    if (areaName === 'local') {
      if (changes.bjmoon_plan || changes.bjmoon_sub_days || changes.bjmoon_enabled) {
        // Re-check quickly to refresh overlay / prompt state
        checkLicenseAndInit();
      }
    }
  });

  // === Start ===
  // Always re-run on refresh / navigation (content script reinjects on SPAs)
  checkLicenseAndInit();
})();