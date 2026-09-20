/*
 * Per-site DOM configuration for auto-reading the blackjack table.
 *
 * IMPORTANT / HONEST NOTE:
 * Every casino renders its blackjack table with different HTML, and those
 * sites change their markup often. The selectors below are STARTING POINTS,
 * not guaranteed to match any live site today. You will almost certainly need
 * to open the game, inspect it with DevTools (right-click a card -> Inspect),
 * and update the selectors here. See README.md -> "Calibrating a site".
 *
 * If auto-detect finds nothing, the overlay falls back to a "no table found"
 * state and you can still use the popup's manual calculator, which always works.
 *
 * Each config provides selectors and a parser that returns:
 *   { playerCards: [ranks], dealerUpcard: rank }
 * Card ranks are strings: "A","2".."10","J","Q","K".
 */
(function (root) {
  'use strict';

  // Pull a rank out of an element's text/attributes using common patterns.
  function rankFromEl(el) {
    if (!el) return null;
    var txt = (el.getAttribute && (el.getAttribute('data-rank') || el.getAttribute('data-value') || el.getAttribute('aria-label'))) || el.textContent || '';
    txt = String(txt).trim().toUpperCase();
    // Match a leading rank token like "A", "10", "K", optionally "10♠", "AS".
    var m = txt.match(/\b(10|[2-9]|[AKIJQKT])\b/);
    if (!m) return null;
    var r = m[1];
    if (r === 'T') r = '10';
    return r;
  }

  function collectRanks(nodeList) {
    var out = [];
    for (var i = 0; i < nodeList.length; i++) {
      var r = rankFromEl(nodeList[i]);
      if (r) out.push(r);
    }
    return out;
  }

  // Generic best-effort parser driven by CSS selectors.
  // NOTE: this selector-based path has no concept of split hands — it reads
  // every matching player card as one hand. If a site splits and this parser
  // is the one active on it, calibrate a real per-hand config (see stakeParser)
  // instead of trusting this for split tables.
  function selectorParser(cfg) {
    return function () {
      var root = cfg.tableSelector ? document.querySelector(cfg.tableSelector) : document;
      if (!root) return null;
      var playerEls = root.querySelectorAll(cfg.playerCardSelector);
      var dealerEls = root.querySelectorAll(cfg.dealerCardSelector);
      var playerCards = collectRanks(playerEls);
      var dealerRanks = collectRanks(dealerEls);
      if (!playerCards.length || !dealerRanks.length) return null;
      // Dealer upcard = first visible dealer card.
      return { dealerUpcard: dealerRanks[0], hands: [{ cards: playerCards, active: true }] };
    };
  }

  // Strict rank normalizer for Stake's card faces (exact single-token text).
  function normRank(s) {
    s = (s || '').trim().toUpperCase();
    if (s === 'T') return '10';
    return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(s) > -1 ? s : null;
  }

  // Purpose-built parser for Stake's blackjack table (stake.us and mirrors).
  // DOM shape (as of build): the hand containers carry stable test ids
  //   [data-testid="dealer"] and [data-testid="player"]; each card is
  //   [data-testid="card-N"] and its rank sits in .face-content span.
  //   The dealer's face-down hole card contains a .face-down node with an
  //   empty span, so we skip any card that has one (and any empty face).
  function readStakeCards(scope) {
    var out = [];
    var cards = scope.querySelectorAll('[data-testid^="card-"]');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.querySelector('.face-down')) continue; // hole card / not yet revealed
      var span = card.querySelector('.face-content span');
      if (!span) continue; // empty face
      var r = normRank(span.textContent);
      if (r) out.push(r);
    }
    return out;
  }

  // "Is this the hand currently awaiting a decision" check for a split table.
  // Confirmed against a live Stake split: the active hand-wrap doesn't carry
  // the marker itself — each of its cards gets .face.active (vs .face.none
  // on the other hand), and its total pill gets .value.active (vs .value.none
  // on the other hand).
  function isActiveHandEl(el) {
    if (el.querySelector('.face.active') || el.querySelector('.value.active')) return true;
    // Generic fallbacks for other sites that mark it on the wrap itself.
    if (el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-selected') === 'true') return true;
    if (el.getAttribute('data-active') === 'true' || el.getAttribute('data-current') === 'true') return true;
    return /(^|\s)(active|is-active|current|is-current|focused|is-focused|selected|is-selected)(\s|$)/i.test(el.className || '');
  }

  function stakeParser() {
    // Try several Dealer selectors
    var dealer = document.querySelector('[data-testid="dealer"]') ||
                 document.querySelector('[class*="dealer"]') ||
                 document.querySelector('[data-test*="dealer"]');
    if (!dealer) return null;
    var dealerCards = readStakeCards(dealer);
    if (dealerCards.length < 1) return null;

    // Try several Player selectors
    var player = document.querySelector('[data-testid="player"]') ||
                 document.querySelector('[class*="player"]') ||
                 document.querySelector('[data-test*="player"]');
    if (!player) return null;

    var handWraps = player.querySelectorAll('.hand-wrap, [class*="hand"], [data-test*="hand"]');
    var handEls = handWraps.length ? handWraps : [player];

    var hands = [];
    for (var i = 0; i < handEls.length; i++) {
      var cards = readStakeCards(handEls[i]);
      if (cards.length < 2) continue; // this hand slot hasn't been dealt into yet
      hands.push({ cards: cards, active: isActiveHandEl(handEls[i]) });
    }
    if (!hands.length) return null;

    // If we found more than one hand but couldn't tell which is active,
    // don't guess which one to recommend for — show all of them, clearly
    // labeled, rather than risk advising on the wrong hand.
    if (hands.length > 1 && !hands.some(function (h) { return h.active; })) {
      hands.forEach(function (h) { h.active = null; });
    }

    return { dealerUpcard: dealerCards[0], hands: hands };
  }

  var configs = [
    {
      id: 'stake',
      label: 'Stake',
      // Matches stake.us, stake.com, stake.games, stake.bet, etc. Some Stake
      // mirror domains won't match by name; the generic fallback still applies.
      match: /(^|\.)stake\.[a-z]{2,}$/i,
      tableSelector: 'main, #root',
      playerCardSelector: '[class*="player"] [class*="card"]',
      dealerCardSelector: '[class*="dealer"] [class*="card"]',
      parser: stakeParser
    },
    {
      id: 'shuffle',
      label: 'Shuffle',
      match: /(^|\.)shuffle\.(us|com)$/i,
      tableSelector: 'main, #root',
      playerCardSelector: '[class*="player"] [class*="card"]',
      dealerCardSelector: '[class*="dealer"] [class*="card"]',
      parser: null
    }
  ];

  // Generic fallback: scan the whole page for two clusters of card-like
  // elements. Heuristic and imperfect — real use should calibrate a config.
  function genericParser() {
    var candidates = document.querySelectorAll(
      '[class*="card"],[data-test*="card"],[data-rank],[class*="Card"]'
    );
    if (candidates.length < 3) return null;
    var groups = {};
    candidates.forEach(function (el) {
      var container = el.closest('[class*="player"],[class*="dealer"],[data-test*="player"],[data-test*="dealer"]');
      var key = 'other';
      if (container) {
        var cls = (container.className + ' ' + (container.getAttribute('data-test') || '')).toLowerCase();
        if (cls.indexOf('dealer') > -1) key = 'dealer';
        else if (cls.indexOf('player') > -1) key = 'player';
      }
      (groups[key] = groups[key] || []).push(el);
    });
    if (!groups.player || !groups.dealer) return null;
    var playerCards = collectRanks(groups.player);
    var dealerRanks = collectRanks(groups.dealer);
    if (!playerCards.length || !dealerRanks.length) return null;
    // No concept of split hands here — every "player"-tagged card counts as
    // one hand. This is the least-calibrated path; see the note above.
    return { dealerUpcard: dealerRanks[0], hands: [{ cards: playerCards, active: true }] };
  }

  function forHost(host) {
    host = (host || '').toLowerCase();
    for (var i = 0; i < configs.length; i++) {
      if (configs[i].match.test(host)) return configs[i];
    }
    return null;
  }

  root.BJSiteConfigs = {
    configs: configs,
    forHost: forHost,
    genericParser: genericParser,
    rankFromEl: rankFromEl
  };
})(typeof window !== 'undefined' ? window : this);