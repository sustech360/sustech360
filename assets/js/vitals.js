/* vitals.js — Core Web Vitals from real visits.
 *
 * Roughly 1 KB, no library, and it reports once as the page goes away. The
 * numbers are the only evidence that matters: a laboratory score on a fast
 * laptop says nothing about the reader on a train with a four-year-old phone.
 *
 * What it collects: how long the main content took to paint (LCP), how much the
 * layout moved (CLS), how long the first interaction took to respond (INP), the
 * first paint (FCP), and how long the server took (TTFB). No identifiers, no
 * URLs beyond the page type, nothing about the reader.
 */
(function (global) {
  'use strict';
  if (!global.PerformanceObserver || !global.MAG_ENDPOINT) return;

  var page = (document.body && document.body.getAttribute('data-page')) || 'other';
  var device = matchMedia('(max-width: 700px)').matches ? 'mobile' : 'desktop';
  var collected = {};
  var sent = false;

  function put(metric, value) {
    if (!isFinite(value)) return;
    collected[metric] = Math.round(metric === 'CLS' ? value * 1000 : value);
  }

  function observe(type, fn, opts) {
    try {
      var po = new PerformanceObserver(function (list) { list.getEntries().forEach(fn); });
      po.observe(Object.assign({ type: type, buffered: true }, opts || {}));
      return po;
    } catch (e) { return null; }
  }

  // LCP keeps being revised upwards until the user interacts; the last value
  // before the page goes away is the one that counts.
  observe('largest-contentful-paint', function (e) { put('LCP', e.startTime); });

  observe('paint', function (e) {
    if (e.name === 'first-contentful-paint') put('FCP', e.startTime);
  });

  var shift = 0;
  observe('layout-shift', function (e) {
    if (!e.hadRecentInput) { shift += e.value; put('CLS', shift); }
  });

  var worstInteraction = 0;
  observe('event', function (e) {
    if (e.duration > worstInteraction) { worstInteraction = e.duration; put('INP', worstInteraction); }
  }, { durationThreshold: 40 });

  try {
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav) put('TTFB', nav.responseStart);
  } catch (e) {}

  function flush() {
    if (sent) return;
    var events = Object.keys(collected).map(function (m) {
      return { m: m, v: collected[m], p: page, d: device };
    });
    if (!events.length) return;
    sent = true;
    var body = JSON.stringify({ action: 'recordVitals', payload: { events: events.slice(0, 12) } });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(global.MAG_ENDPOINT, new Blob([body], { type: 'text/plain;charset=utf-8' }));
      } else {
        fetch(global.MAG_ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'no-cors',
                                     headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      }
    } catch (e) { /* never let measurement break a page */ }
  }

  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);
})(window);
