/* performance.js — the Performance Centre.
 *
 * Field measurements first, because they are the evidence; the payload budget
 * second, because it is the thing that quietly goes wrong between releases. The
 * screen says how the numbers were gathered, so nobody reports them as fact to
 * someone who will ask.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    var NAMES = {
      LCP: 'Largest paint', FCP: 'First paint', INP: 'Interaction',
      TTFB: 'Server response', CLS: 'Layout shift'
    };

    function value(m) {
      return m.unit === 'x1000' ? (m.p75 / 1000).toFixed(3) : m.p75 + ' ms';
    }
    function kb(n) { return Math.round((n || 0) / 102.4) / 10 + ' KB'; }

    views.performance = function (v) {
      Promise.all([api.call('performanceReport', {}), api.call('payloadBudget')]).then(function (r) {
        var report = r[0], budget = r[1];
        var pages = {};
        report.metrics.forEach(function (m) { (pages[m.page] = pages[m.page] || []).push(m); });

        v.innerHTML = '<h2>Performance</h2>' +
          '<div class="card"><p>' + report.samples + ' measurements since ' + esc(report.since) + '.</p>' +
          '<p class="hint">' + esc(report.caveat) + '</p></div>' +

          (report.problems.length
            ? '<div class="card"><h2>Worth looking at</h2><table><tbody>' +
              report.problems.map(function (m) {
                return '<tr><td>' + esc(NAMES[m.metric] || m.metric) + ' on ' + esc(m.page) + ' (' + esc(m.device) + ')</td>' +
                  '<td>' + esc(value(m)) + '</td><td>' + esc(m.rating) + '</td>' +
                  '<td class="hint">' + m.samples + ' samples</td></tr>';
              }).join('') + '</tbody></table></div>'
            : '<div class="card"><p>Nothing is rated poor with enough samples to act on.</p></div>') +

          Object.keys(pages).sort().map(function (page) {
            return '<div class="card"><h2>' + esc(page) + '</h2>' +
              '<table><thead><tr><th>Metric</th><th>Device</th><th>p75</th><th>Mean</th><th>Worst</th><th>Samples</th><th></th></tr></thead><tbody>' +
              pages[page].map(function (m) {
                return '<tr><td>' + esc(NAMES[m.metric] || m.metric) + '</td><td>' + esc(m.device) + '</td>' +
                  '<td><strong>' + esc(value(m)) + '</strong></td>' +
                  '<td class="hint">' + (m.unit === 'x1000' ? (m.mean / 1000).toFixed(3) : m.mean + ' ms') + '</td>' +
                  '<td class="hint">' + (m.unit === 'x1000' ? (m.worst / 1000).toFixed(3) : m.worst + ' ms') + '</td>' +
                  '<td>' + m.samples + '</td><td>' + esc(m.rating) + '</td></tr>';
              }).join('') + '</tbody></table></div>';
          }).join('') +

          '<div class="card"><h2>Payload budget</h2>' +
          (budget.measured_at ? '<p class="hint">Measured at publication, ' +
            esc(String(budget.measured_at).slice(0, 16).replace('T', ' ')) + '.</p>' : '') +
          '<table><thead><tr><th>File</th><th>Size</th><th>Budget</th><th>Used</th></tr></thead><tbody>' +
          budget.lines.map(function (l) {
            return '<tr><td><code>' + esc(l.path) + '</code></td><td>' + esc(kb(l.bytes)) + '</td>' +
              '<td class="hint">' + esc(kb(l.budget)) + '</td>' +
              '<td>' + l.share + '%' + (l.over ? ' — over' : '') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<ul>' + budget.advice.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>' +

          '<div class="card"><h2>What the architecture already does</h2><ul class="hint">' +
          '<li>Readers never wait for Apps Script: every public page is static files from a CDN.</li>' +
          '<li>The shell loads from one bootstrap file rather than five requests; the separate files remain as a fallback.</li>' +
          '<li>Publishing bumps a build number that the service worker imports, so a publish retires every stale cached shell.</li>' +
          '<li>Ads and analytics load after content and an unfillable ad slot takes up no space.</li>' +
          '</ul></div>';
      }).catch(function (e) { v.innerHTML = '<h2>Performance</h2>'; message(v, explain(e), 'err'); });
    };

    return views;
  };
})();
