/* ads.js — the fallback chain, the only part of advertising that decides what a
 * reader sees. It is deliberately pure and separate from the DOM so the same
 * function that runs in the browser runs in the test suite: an ad system that
 * silently picks the wrong creative is a commercial and an editorial problem.
 *
 * The chain comes from the backend per placement, e.g.
 *   ["DIRECT","PREMIUM","STANDARD","ADSENSE","HOUSE","RELATED","COLLAPSE"]
 * and is walked in order until a step yields something. COLLAPSE means show
 * nothing at all rather than an empty bordered box.
 */
(function (global) {
  'use strict';

  var PAID = { DIRECT: 1, PREMIUM: 1, STANDARD: 1 };

  function inWindow(c, now) {
    if (c.starts && new Date(c.starts).getTime() > now) return false;
    if (c.ends && new Date(c.ends).getTime() < now) return false;
    return true;
  }

  function matchesTargeting(c, ctx) {
    var t = c.targeting || {};
    if (t.sections && t.sections.length && ctx.section) {
      if (t.sections.indexOf(ctx.section) === -1) return false;
    }
    if (t.devices && t.devices.length && ctx.device) {
      if (t.devices.indexOf(ctx.device) === -1) return false;
    }
    return true;
  }

  /** Weighted choice. Weight is an editorial lever — a campaign paying for more
   *  of the rotation gets more of it — not a randomiser to be clever about. */
  function choose(pool, rand) {
    if (pool.length === 1) return pool[0];
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += Math.max(1, Number(pool[i].weight || 1));
    var roll = (rand === undefined ? Math.random() : rand) * total;
    for (i = 0; i < pool.length; i++) {
      roll -= Math.max(1, Number(pool[i].weight || 1));
      if (roll <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /**
   * Resolve one placement.
   * @returns {object|null} {kind, creative|client|article, label} or null to collapse.
   */
  function resolve(cfg, placement, ctx) {
    ctx = ctx || {};
    var now = ctx.now === undefined ? Date.now() : ctx.now;
    var slot = ((cfg && cfg.placements) || {})[placement];
    if (!slot || !slot.active) return null;
    if (ctx.advertisingEnabled === false) return null;

    var chain = slot.chain || ['COLLAPSE'];
    for (var i = 0; i < chain.length; i++) {
      var step = chain[i];
      if (step === 'COLLAPSE') return null;

      if (step === 'ADSENSE') {
        // Both halves are required. The client identifies the account; the slot
        // identifies the unit, and Google fills nothing without it — an <ins>
        // with a client and no slot is valid markup that stays empty forever.
        var slot = (ctx.adsenseSlots || {})[placement];
        if (!ctx.adsenseClient || !slot) continue;
        return { kind: 'adsense', client: ctx.adsenseClient, slot: slot, label: 'Advertisement' };
      }

      if (step === 'RELATED') {
        // Not an advertisement: a link to our own journalism, so the slot is
        // never an apologetic gap. Labelled as what it is.
        if (!ctx.related) continue;
        return { kind: 'related', article: ctx.related, label: 'More from us' };
      }

      var pool = (step === 'HOUSE' || step === 'MAGAZINE' ? (cfg.house || []) : (cfg.creatives || []))
        .filter(function (c) {
          if (c.placement !== placement) return false;
          if (step === 'HOUSE' || step === 'MAGAZINE') { if (c.tier !== step) return false; }
          else if (c.tier !== step) return false;
          if (!PAID[c.tier] && step !== 'HOUSE' && step !== 'MAGAZINE') return false;
          return inWindow(c, now) && matchesTargeting(c, ctx);
        });

      if (pool.length) {
        return { kind: 'image', creative: choose(pool, ctx.rand), label: pool[0].label || 'Advertisement' };
      }
    }
    return null;
  }

  /* ---- delivery counting ----
   * Counts are gathered in the page and sent once, on the way out, as a single
   * beacon. Readers are never made to wait for an ad request, and the numbers
   * are ours rather than audited: ad blockers, cached pages and browsers that
   * discard the unload beacon are all uncounted. The control centre says so.
   */
  function Counter(endpoint) {
    this.endpoint = endpoint;
    this.pending = {};
    this.sent = false;
  }

  Counter.prototype.bump = function (id, kind) {
    if (!id) return;
    var e = this.pending[id] || (this.pending[id] = { id: id, i: 0, c: 0 });
    if (kind === 'click') e.c += 1; else e.i += 1;
  };

  /** Hands what has been counted to the page's single beacon rather than
   *  sending its own. One visit, one request, one Apps Script execution. */
  Counter.prototype.drain = function () {
    var events = [];
    for (var k in this.pending) if (this.pending.hasOwnProperty(k)) events.push(this.pending[k]);
    this.pending = {};
    return events.slice(0, 40);
  };

  Counter.prototype.flush = function () {
    var events = this.drain();
    if (!events.length || !this.endpoint) return false;
    var body = JSON.stringify({ action: 'recordTelemetry', payload: { ads: events } });
    try {
      if (global.navigator && navigator.sendBeacon) {
        navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'text/plain;charset=utf-8' }));
      } else {
        fetch(this.endpoint, { method: 'POST', body: body, keepalive: true, mode: 'no-cors',
                               headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      }
      return true;
    } catch (e) { return false; }
  };

  global.AdChain = { resolve: resolve, choose: choose, Counter: Counter };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.AdChain;
})(typeof window !== 'undefined' ? window : globalThis);
