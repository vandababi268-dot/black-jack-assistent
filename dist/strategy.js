/*
 * Blackjack basic-strategy engine with card counting.
 *
 * Pure, dependency-free. Given the player's cards and the dealer's upcard it
 * returns the mathematically optimal basic-strategy decision. This does NOT
 * beat the house on its own (basic strategy trims the house edge to ~0.5%);
 * it just plays every hand the way the charts say is optimal.
 *
 * With card counting (Hi-Lo system), it can detect when the player has an edge
 * and adjust strategy accordingly (index plays).
 *
 * Default rules: multi-deck (4-8), dealer STANDS on soft 17 (S17),
 * double-after-split allowed (DAS), late surrender allowed.
 * Toggle via the options argument to match a specific table.
 *
 * Exposes a global `BJStrategy` (browser) and module.exports (node/tests).
 */
(function (root) {
  'use strict';

  // Normalize a card rank string to a numeric blackjack value.
  // Accepts: "A", "2".."10", "J", "Q", "K" (case-insensitive). Ace = 11.
  function cardValue(rank) {
    if (rank == null) return null;
    var r = String(rank).trim().toUpperCase();
    if (r === 'A' || r === 'ACE') return 11;
    if (r === 'K' || r === 'Q' || r === 'J' || r === '10' || r === 'T') return 10;
    var n = parseInt(r, 10);
    if (n >= 2 && n <= 9) return n;
    return null;
  }

  // Evaluate a set of card ranks -> { total, soft }.
  // "soft" means an ace is currently counted as 11 without busting.
  function evaluateHand(cards) {
    var total = 0;
    var aces = 0;
    for (var i = 0; i < cards.length; i++) {
      var v = cardValue(cards[i]);
      if (v == null) continue;
      total += v;
      if (v === 11) aces++;
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return { total: total, soft: aces > 0 };
  }

  var ACTIONS = {
    HIT: { code: 'HIT', label: 'Hit', color: '#22c55e' },
    STAND: { code: 'STAND', label: 'Stand', color: '#ef4444' },
    DOUBLE: { code: 'DOUBLE', label: 'Double', color: '#3b82f6' },
    SPLIT: { code: 'SPLIT', label: 'Split', color: '#a855f7' },
    SURRENDER: { code: 'SURRENDER', label: 'Surrender', color: '#f59e0b' }
  };

  function defaults(options) {
    options = options || {};
    return {
      hitSoft17: options.hitSoft17 === true, // H17 if true, else S17
      das: options.das !== false, // double-after-split allowed by default
      surrender: options.surrender === true, // off by default (matches the S17 chart, which has no surrender row)
      canDouble: options.canDouble !== false,
      canSplit: options.canSplit !== false,
      canSurrender: options.canSurrender !== false,
      decks: options.decks !== undefined ? options.decks : 6 // number of decks in shoe
    };
  }

  // === CARD COUNTING (Hi-Lo System) ===
  // Global counting state (reset per shoe)
  var countingState = {
    runningCount: 0,
    decksSeen: 0,
    totalDecks: 6,
    cardsSeenThisRound: [],
    isInitialized: false
  };

  // Hi-Lo card values: 2-6 = +1, 7-9 = 0, 10-A = -1
  const HI_LO_VALUES = {
    '2': 1, '3': 1, '4': 1, '5': 1, '6': 1,
    '7': 0, '8': 0, '9': 0,
    '10': -1, 'J': -1, 'Q': -1, 'K': -1, 'A': -1
  };

  // Initialize or reset counting for a new shoe
  function initCounting(options) {
    var opts = defaults(options);
    countingState.runningCount = 0;
    countingState.decksSeen = 0;
    countingState.totalDecks = opts.decks;
    countingState.cardsSeenThisRound = [];
    countingState.isInitialized = true;
  }

  // Update running count with a card (call when card is seen)
  function updateCountWithCard(card) {
    if (!countingState.isInitialized) return;
    var value = HI_LO_VALUES[card];
    if (value !== undefined) {
      countingState.runningCount += value;
      countingState.cardsSeenThisRound.push(card);
    }
  }

  // Calculate true count (running count divided by decks remaining)
  function getTrueCount() {
    if (!countingState.isInitialized) return 0;
    var decksRemaining = countingState.totalDecks - countingState.decksSeen;
    if (decksRemaining <= 0) decksRemaining = 0.5; // avoid division by zero
    return Math.floor(countingState.runningCount / decksRemaining);
  }

  // Estimate decks seen based on cards dealt
  // This is approximate - in reality we'd need better shoe detection from the site
  function updateDecksSeen() {
    if (!countingState.isInitialized) return;
    // Each card is 1/52 of a deck
    var decksFromCards = countingState.cardsSeenThisRound.length / 52;
    countingState.decksSeen = Math.min(decksFromCards, countingState.totalDecks);
  }

  // Pair strategy. Returns an action code or null (fall through to hard/soft).
  function pairPlay(pairValue, dealer, o) {
    switch (pairValue) {
      case 11: return 'SPLIT';               // A,A
      case 10: return 'STAND';               // 10,10
      case 9:  return (dealer === 7 || dealer >= 10) ? 'STAND' : 'SPLIT'; // split vs 2-6,8,9
      case 8:  return 'SPLIT';               // 8,8
      case 7:  return dealer <= 7 ? 'SPLIT' : 'HIT';
      case 6:  return (dealer >= 2 && dealer <= 6) ? 'SPLIT' : 'HIT';
      case 5:  return null;                  // treat as hard 10
      case 4:  return (o.das && (dealer === 5 || dealer === 6)) ? 'SPLIT' : 'HIT';
      case 3:  return dealer <= 7 ? 'SPLIT' : 'HIT';
      case 2:  return dealer <= 7 ? 'SPLIT' : 'HIT';
      default: return null;
    }
  }

  // Soft-total strategy. Returns { action, fallback } where fallback is used
  // if doubling isn't available. total is 13..21 (A counted as 11).
  function softPlay(total, dealer) {
    switch (total) {
      case 21:
      case 20:
        return { action: 'STAND', fallback: 'STAND' };
      case 19: // A,8 — double vs 6, otherwise stand
        return dealer === 6 ? { action: 'DOUBLE', fallback: 'STAND' } : { action: 'STAND', fallback: 'STAND' };
      case 18: // A,7 — double vs 2-6, stand vs 7-8, hit vs 9-A
        if (dealer >= 2 && dealer <= 6) return { action: 'DOUBLE', fallback: 'STAND' };
        if (dealer === 7 || dealer === 8) return { action: 'STAND', fallback: 'STAND' };
        return { action: 'HIT', fallback: 'HIT' };
      case 17: // A,6
        return (dealer >= 3 && dealer <= 6) ? { action: 'DOUBLE', fallback: 'HIT' } : { action: 'HIT', fallback: 'HIT' };
      case 16: // A,5
      case 15: // A,4
        return (dealer >= 4 && dealer <= 6) ? { action: 'DOUBLE', fallback: 'HIT' } : { action: 'HIT', fallback: 'HIT' };
      case 14: // A,3
      case 13: // A,2
        return (dealer >= 5 && dealer <= 6) ? { action: 'DOUBLE', fallback: 'HIT' } : { action: 'HIT', fallback: 'HIT' };
      default:
        return { action: 'HIT', fallback: 'HIT' };
    }
  }

  // Hard-total strategy. Returns { action, fallback }.
  function hardPlay(total, dealer) {
    if (total >= 17) return { action: 'STAND', fallback: 'STAND' };
    if (total >= 13 && total <= 16) return (dealer >= 2 && dealer <= 6) ? { action: 'STAND', fallback: 'STAND' } : { action: 'HIT', fallback: 'HIT' };
    if (total === 12) return (dealer >= 4 && dealer <= 6) ? { action: 'STAND', fallback: 'STAND' } : { action: 'HIT', fallback: 'HIT' };
    if (total === 11) return { action: 'DOUBLE', fallback: 'HIT' };
    if (total === 10) return (dealer >= 2 && dealer <= 9) ? { action: 'DOUBLE', fallback: 'HIT' } : { action: 'HIT', fallback: 'HIT' };
    if (total === 9) return (dealer >= 3 && dealer <= 6) ? { action: 'DOUBLE', fallback: 'HIT' } : { action: 'HIT', fallback: 'HIT' };
    return { action: 'HIT', fallback: 'HIT' };
  }

  // Late-surrender decision on the first two cards. Returns true/false.
  function shouldSurrender(total, soft, dealer, isPair, pairValue, o) {
    if (soft) return false;
    if (isPair && pairValue === 8) {
      // 8,8 surrenders vs Ace only under H17; otherwise split.
      return o.hitSoft17 && dealer === 11;
    }
    if (total === 16) return dealer === 9 || dealer === 10 || dealer === 11;
    if (total === 15) {
      if (dealer === 10) return true;
      if (o.hitSoft17 && (dealer === 10 || dealer === 11)) return true;
      return false;
    }
    if (o.hitSoft17 && total === 17) return dealer === 11; // H17 only
    return false;
  }

  /*
   * Main entry point.
   *   playerCards: array of rank strings, e.g. ["A","7"] or ["5","3","4"]
   *   dealerUpcard: single rank string, e.g. "6"
   *   options: rule overrides (see defaults())
   * Returns { action, label, color, reason, hand } or { error }.
   */
  function getBestPlay(playerCards, dealerUpcard, options) {
    var o = defaults(options);
    if (!Array.isArray(playerCards) || playerCards.length < 2) {
      return { error: 'Need at least two player cards.' };
    }
    var dealer = cardValue(dealerUpcard);
    if (dealer == null) return { error: 'Invalid or missing dealer upcard.' };

    var hand = evaluateHand(playerCards);
    var isFirstDecision = playerCards.length === 2;
    var canDouble = o.canDouble && isFirstDecision;

    if (hand.total > 21) {
      return { action: 'STAND', label: 'Bust', color: '#6b7280', reason: 'Hand is over 21.', hand: hand };
    }

    // Detect a pair (exactly two cards of equal blackjack value).
    var isPair = false, pairValue = null;
    if (isFirstDecision) {
      var v0 = cardValue(playerCards[0]);
      var v1 = cardValue(playerCards[1]);
      if (v0 != null && v0 === v1) { isPair = true; pairValue = v0; }
    }

    // 1) Surrender takes priority when offered.
    if (o.surrender && o.canSurrender && isFirstDecision &&
        shouldSurrender(hand.total, hand.soft, dealer, isPair, pairValue, o)) {
      return decorate('SURRENDER', 'Surrender ' + hand.total + ' vs dealer ' + upLabel(dealer) + ' (fold if allowed, else ' + (hand.total === 15 ? 'hit' : 'hit') + ').', hand);
    }

    // 2) Pair splitting.
    if (isPair && o.canSplit) {
      var p = pairPlay(pairValue, dealer, o);
      if (p === 'SPLIT') {
        return decorate('SPLIT', 'Split ' + pairLabel(pairValue) + ' vs dealer ' + upLabel(dealer) + '.', hand);
      }
      // p === 'STAND' (10s/9s cases) is a direct instruction.
      if (p === 'STAND') {
        return decorate('STAND', 'Keep the pair; stand ' + hand.total + ' vs dealer ' + upLabel(dealer) + '.', hand);
      }
      // p === null (5,5) or 'HIT' -> fall through to hard/soft totals below.
    }

    // 3) Soft or hard total.
    var rec = hand.soft ? softPlay(hand.total, dealer) : hardPlay(hand.total, dealer);
    var action = rec.action;
    if (action === 'DOUBLE' && !canDouble) action = rec.fallback;

    var reason = (hand.soft ? 'Soft ' : 'Hard ') + hand.total + ' vs dealer ' + upLabel(dealer) + ' → ' + ACTIONS[action].label + '.';
    return decorate(action, reason, hand);
  }

  // === CARD COUNTING ENHANCED STRATEGY ===
  // Get best play with card counting adjustments (index plays)
  function getBestPlayWithCount(playerCards, dealerUpcard, options) {
    // Update decks seen estimate
    updateDecksSeen();

    // Get basic strategy recommendation
    var basicResult = getBestPlay(playerCards, dealerUpcard, options);
    if (basicResult.error) return basicResult; // propagate error

    // If counting not initialized, return basic strategy
    if (!countingState.isInitialized) {
      return basicResult;
    }

    var trueCount = getTrueCount();
    var hand = evaluateHand(playerCards);
    var isFirstDecision = playerCards.length === 2;
    var canDouble = (options && options.canDouble !== false) && isFirstDecision;
    var canSplit = (options && options.canSplit !== false) && isFirstDecision;

    // Apply index plays (deviations from basic strategy based on true count)

    // 16 vs 10: Stand at TC >= 0 (normally hit)
    if (playerCards.length === 2 && hand.total === 16 && dealerUpcard === '10') {
      if (trueCount >= 0 && canDouble === false) { // can't double on 16 anyway
        return decorate('STAND', 'Stand 16 vs 10 (TC=' + trueCount + ')', hand);
      }
    }

    // 15 vs 10: Stand at TC >= 4 (normally hit)
    if (playerCards.length === 2 && hand.total === 15 && dealerUpcard === '10') {
      if (trueCount >= 4) {
        return decorate('STAND', 'Stand 15 vs 10 (TC=' + trueCount + ')', hand);
      }
    }

    // 12 vs 3: Stand at TC >= 2 (normally hit)
    if (playerCards.length === 2 && hand.total === 12 && dealerUpcard === '3') {
      if (trueCount >= 2) {
        return decorate('STAND', 'Stand 12 vs 3 (TC=' + trueCount + ')', hand);
      }
    }

    // 12 vs 2: Stand at TC >= 3 (normally hit)
    if (playerCards.length === 2 && hand.total === 12 && dealerUpcard === '2') {
      if (trueCount >= 3) {
        return decorate('STAND', 'Stand 12 vs 2 (TC=' + trueCount + ')', hand);
      }
    }

    // 10 vs 10: Double at TC >= 4 (normally hit)
    if (playerCards.length === 2 && hand.total === 10 && dealerUpcard === '10' && canDouble) {
      if (trueCount >= 4) {
        return decorate('DOUBLE', 'Double 10 vs 10 (TC=' + trueCount + ')', hand);
      }
    }

    // 10 vs Ace: Double at TC >= 4 (normally hit)
    if (playerCards.length === 2 && hand.total === 10 && dealerUpcard === 'A' && canDouble) {
      if (trueCount >= 4) {
        return decorate('DOUBLE', 'Double 10 vs A (TC=' + trueCount + ')', hand);
      }
    }

    // 9 vs 2: Double at TC >= 1 (normally hit)
    if (playerCards.length === 2 && hand.total === 9 && dealerUpcard === '2' && canDouble) {
      if (trueCount >= 1) {
        return decorate('DOUBLE', 'Double 9 vs 2 (TC=' + trueCount + ')', hand);
      }
    }

    // 9 vs 7: Double at TC >= 4 (normally hit)
    if (playerCards.length === 2 && hand.total === 9 && dealerUpcard === '7' && canDouble) {
      if (trueCount >= 4) {
        return decorate('DOUBLE', 'Double 9 vs 7 (TC=' + trueCount + ')', hand);
      }
    }

    // 10 vs 9: Double at TC >= 3 (normally hit)
    if (playerCards.length === 2 && hand.total === 10 && dealerUpcard === '9' && canDouble) {
      if (trueCount >= 3) {
        return decorate('DOUBLE', 'Double 10 vs 9 (TC=' + trueCount + ')', hand);
      }
    }

    // Insurance: Take insurance at TC >= 3 (if offered)
    // Note: We don't have insurance option in our ACTIONS, so we'll note it in reason
    if (playerCards.length === 2 && dealerUpcard === 'A') {
      if (trueCount >= 3) {
        // Insurance is a side bet, not a play on the hand
        // We'll keep the basic strategy but note insurance is favorable
        var insuranceNote = ' (Insurance TC=' + trueCount + ')';
        var reason = basicResult.reason + insuranceNote;
        return decorate(basicResult.action, reason, hand);
      }
    }

    // 16 vs 9: Stand at TC >= 5 (normally hit)
    if (playerCards.length === 2 && hand.total === 16 && dealerUpcard === '9') {
      if (trueCount >= 5) {
        return decorate('STAND', 'Stand 16 vs 9 (TC=' + trueCount + ')', hand);
      }
    }

    // 13 vs 2: Stand at TC >= -1 (normally hit)
    if (playerCards.length === 2 && hand.total === 13 && dealerUpcard === '2') {
      if (trueCount >= -1) {
        return decorate('STAND', 'Stand 13 vs 2 (TC=' + trueCount + ')', hand);
      }
    }

    // 13 vs 3: Stand at TC >= -2 (normally hit)
    if (playerCards.length === 2 && hand.total === 13 && dealerUpcard === '3') {
      if (trueCount >= -2) {
        return decorate('STAND', 'Stand 13 vs 3 (TC=' + trueCount + ')', hand);
      }
    }

    // 12 vs 4: Stand at TC >= 0 (normally hit)
    if (playerCards.length === 2 && hand.total === 12 && dealerUpcard === '4') {
      if (trueCount >= 0) {
        return decorate('STAND', 'Stand 12 vs 4 (TC=' + trueCount + ')', hand);
      }
    }

    // 12 vs 5: Stand at TC >= -2 (normally hit)
    if (playerCards.length === 2 && hand.total === 12 && dealerUpcard === '5') {
      if (trueCount >= -2) {
        return decorate('STAND', 'Stand 12 vs 5 (TC=' + trueCount + ')', hand);
      }
    }

    // 12 vs 6: Stand at TC >= -1 (normally hit)
    if (playerCards.length === 2 && hand.total === 12 && dealerUpcard === '6') {
      if (trueCount >= -1) {
        return decorate('STAND', 'Stand 12 vs 6 (TC=' + trueCount + ')', hand);
      }
    }

    // 11 vs Ace: Double at TC >= 1 (normally double anyway, but more confident)
    // Already handled in basic strategy

    // 11 vs everything else: Always double (basic strategy)

    // 10 vs everything else: Already handled above for specific cases

    // 9 vs everything else: Already handled above for specific cases

    // Ace-7 (soft 18) vs 2: Double at TC >= 3 (normally stand)
    if (playerCards.length === 2 && hand.total === 18 && hand.soft === true && dealerUpcard === '2') {
      if (trueCount >= 3 && canDouble) {
        return decorate('DOUBLE', 'Double A,7 vs 2 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-7 (soft 18) vs 7: Double at TC >= 1 (normally stand)
    if (playerCards.length === 2 && hand.total === 18 && hand.soft === true && dealerUpcard === '7') {
      if (trueCount >= 1 && canDouble) {
        return decorate('DOUBLE', 'Double A,7 vs 7 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-7 (soft 18) vs 8: Double at TC >= 0 (normally stand)
    if (playerCards.length === 2 && hand.total === 18 && hand.soft === true && dealerUpcard === '8') {
      if (trueCount >= 0 && canDouble) {
        return decorate('DOUBLE', 'Double A,7 vs 8 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-6 (soft 17) vs 2: Double at TC >= 1 (normally hit)
    if (playerCards.length === 2 && hand.total === 17 && hand.soft === true && dealerUpcard === '2') {
      if (trueCount >= 1 && canDouble) {
        return decorate('DOUBLE', 'Double A,6 vs 2 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-6 (soft 17) vs 3: Double at TC >= 0 (normally hit)
    if (playerCards.length === 2 && hand.total === 17 && hand.soft === true && dealerUpcard === '3') {
      if (trueCount >= 0 && canDouble) {
        return decorate('DOUBLE', 'Double A,6 vs 3 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-6 (soft 17) vs 4: Double at TC >= -2 (normally hit)
    if (playerCards.length === 2 && hand.total === 17 && hand.soft === true && dealerUpcard === '4') {
      if (trueCount >= -2 && canDouble) {
        return decorate('DOUBLE', 'Double A,6 vs 4 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-6 (soft 17) vs 5: Double at TC >= -3 (normally hit)
    if (playerCards.length === 2 && hand.total === 17 && hand.soft === true && dealerUpcard === '5') {
      if (trueCount >= -3 && canDouble) {
        return decorate('DOUBLE', 'Double A,6 vs 5 (TC=' + trueCount + ')', hand);
      }
    }

    // Ace-6 (soft 17) vs 6: Double at TC >= -4 (normally hit)
    if (playerCards.length === 2 && hand.total === 17 && hand.soft === true && dealerUpcard === '6') {
      if (trueCount >= -4 && canDouble) {
        return decorate('DOUBLE', 'Double A,6 vs 6 (TC=' + trueCount + ')', hand);
      }
    }

    // Return basic strategy if no index play triggered
    return basicResult;
  }

  function decorate(code, reason, hand) {
    var a = ACTIONS[code];
    return { action: a.code, label: a.label, color: a.color, reason: reason, hand: hand };
  }

  function upLabel(v) { return v === 11 ? 'A' : String(v); }
  function pairLabel(v) { return v === 11 ? 'Aces' : (v === 10 ? '10s' : v + 's'); }

  var api = {
    getBestPlay: getBestPlay,
    getBestPlayWithCount: getBestPlayWithCount,
    evaluateHand: evaluateHand,
    cardValue: cardValue,
    ACTIONS: ACTIONS,
    // Card counting API
    initCounting: initCounting,
    updateCountWithCard: updateCountWithCard,
    getTrueCount: getTrueCount,
    resetCount: function() { countingState.isInitialized = false; } // for new shoe
  };

  root.BJStrategy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);