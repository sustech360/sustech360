/* ads-admin.js — the Advertising Control Centre.
 *
 * Two rules are visible in this interface rather than hidden behind it: nothing
 * runs until someone other than its uploader approves it, and pulling a
 * creative is always one click away with a reason attached.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    function reload(v) { return function () { views.advertising(v); }; }

    views.advertising = function (v) {
      Promise.all([api.call('adsBundle'), api.call('adDelivery', { })]).then(function (r) {
        var b = r[0], delivery = r[1];
        var pending = b.creatives.filter(function (c) { return c.status === 'PENDING'; });

        v.innerHTML = '<h2>Advertising</h2>' +
          (pending.length ? '<div class="card"><h2>Waiting for approval</h2>' +
            '<p class="hint">Someone other than the person who uploaded it has to approve each one.</p>' +
            '<table><tbody>' + pending.map(function (c) {
              return '<tr><td>' + esc(c.name) + '<br><span class="hint">' + esc(c.placement) + ' · ' + esc(c.tier) +
                ' · ' + esc(c.label) + '</span></td>' +
                '<td class="hint">' + esc(c.url) + '</td>' +
                '<td><button class="act" data-ok="' + esc(c.id) + '">Approve</button> ' +
                '<button class="danger" data-no="' + esc(c.id) + '">Reject</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '') +

          '<div class="card"><h2>Creatives</h2><table><thead><tr>' +
          '<th>Creative</th><th>Placement</th><th>Runs</th><th>State</th><th></th></tr></thead><tbody>' +
          b.creatives.map(function (c) {
            return '<tr><td>' + esc(c.name) + '<br><span class="hint">' + esc(c.advertiser || 'house') +
              ' · ' + esc(c.tier) + ' · weight ' + esc(c.weight) + '</span></td>' +
              '<td>' + esc(c.placement) + '</td>' +
              '<td class="hint">' + esc(String(c.starts).slice(0, 10)) + ' → ' + esc(String(c.ends || '').slice(0, 10) || 'open') + '</td>' +
              '<td>' + esc(c.status) + '</td>' +
              '<td>' + (c.status === 'APPROVED' ? '<button class="danger" data-pause="' + esc(c.id) + '">Pull</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +

          '<div class="card"><h2>Placements</h2><table><tbody>' +
          b.placements.map(function (p) {
            var chain = Array.isArray(p.chain) ? p.chain : JSON.parse(p.chain || '[]');
            return '<tr><td><code>' + esc(p.id) + '</code><br><span class="hint">' + esc(p.name) + '</span></td>' +
              '<td class="hint">' + esc(chain.join(' → ')) + '</td>' +
              '<td>' + (p.active ? 'On' : 'Off') + '</td>' +
              '<td><button class="ghost" data-slot="' + esc(p.id) + '|' + (p.active ? '1' : '0') + '">' +
              (p.active ? 'Turn off' : 'Turn on') + '</button></td></tr>';
          }).join('') + '</tbody></table>' +
          '<p class="hint">Every chain ends in COLLAPSE: a slot that cannot be filled takes up no space at all.</p></div>' +

          '<div class="card"><h2>Delivery since ' + esc(delivery.since) + '</h2>' +
          '<p class="hint">' + esc(delivery.caveat) + '</p>' +
          (delivery.rows.length ? '<table><thead><tr><th>Creative</th><th>Impressions</th><th>Clicks</th><th>Rate</th></tr></thead><tbody>' +
            delivery.rows.map(function (x) {
              return '<tr><td>' + esc(x.name) + '</td><td>' + x.impressions + '</td><td>' + x.clicks +
                '</td><td>' + x.rate + '%</td></tr>';
            }).join('') + '</tbody></table>' : '<p>Nothing counted yet.</p>') + '</div>' +

          '<div class="card"><h2>Advertisers and campaigns</h2><table><tbody>' +
          b.advertisers.map(function (a) {
            var camps = b.campaigns.filter(function (c) { return c.advertiser_id === a.id; });
            return '<tr><td>' + esc(a.company) + '<br><span class="hint">' + esc(a.email) + '</span></td>' +
              '<td class="hint">' + (camps.length ? camps.map(function (c) {
                return esc(c.name) + ' (' + esc(c.tier) + ', ' + esc(c.status) + ')';
              }).join('<br>') : 'no campaigns') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +

          '<div class="card"><h2>Add an advertiser</h2>' +
          '<label for="acomp">Company</label><input id="acomp">' +
          '<label for="aemail">Contact email</label><input id="aemail" type="email">' +
          '<label for="aweb">Website</label><input id="aweb" placeholder="https://">' +
          '<div class="rowbtns"><button class="act" id="addadv">Add</button></div></div>' +

          '<div class="card"><h2>Publish advertising</h2>' +
          '<p class="hint">Approved creatives and their images go to the live site. Supervisor admin only, like every other publication.</p>' +
          '<div class="rowbtns"><button class="act" id="pubads">Publish advertising</button></div></div><div id="admsg"></div>';

        v.querySelectorAll('[data-ok]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            api.call('reviewCreative', { creative_id: btn.getAttribute('data-ok'), decision: 'APPROVED' })
              .then(reload(v)).catch(function (e) { message(document.getElementById('admsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-no]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var reason = prompt('Why is this not running?');
            if (!reason) return;
            api.call('reviewCreative', { creative_id: btn.getAttribute('data-no'), decision: 'REJECTED', reason: reason })
              .then(reload(v)).catch(function (e) { message(document.getElementById('admsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-pause]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var reason = prompt('Why is this being pulled?');
            if (!reason) return;
            api.call('pauseCreative', { creative_id: btn.getAttribute('data-pause'), reason: reason })
              .then(reload(v)).catch(function (e) { message(document.getElementById('admsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-slot]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var p = btn.getAttribute('data-slot').split('|');
            var slot = b.placements.filter(function (x) { return x.id === p[0]; })[0];
            api.call('saveAdPlacement', {
              id: slot.id, name: slot.name, description: slot.description,
              chain: Array.isArray(slot.chain) ? slot.chain : JSON.parse(slot.chain || '[]'),
              active: p[1] !== '1'
            }).then(reload(v)).catch(function (e) { message(document.getElementById('admsg'), explain(e), 'err'); });
          });
        });
        document.getElementById('addadv').addEventListener('click', function () {
          api.call('saveAdvertiser', {
            company: document.getElementById('acomp').value,
            email: document.getElementById('aemail').value,
            website: document.getElementById('aweb').value
          }).then(reload(v)).catch(function (e) { message(document.getElementById('admsg'), explain(e), 'err'); });
        });
        document.getElementById('pubads').addEventListener('click', function () {
          if (!confirm('Publish the approved advertising to the live site?')) return;
          api.call('publishAds').then(function (res) {
            message(document.getElementById('admsg'), 'Published ' + res.files.length + ' file(s).', 'ok');
          }).catch(function (e) { message(document.getElementById('admsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Advertising</h2>'; message(v, explain(e), 'err'); });
    };

    return views;
  };
})();
