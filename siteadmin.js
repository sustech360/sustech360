/* siteadmin.js — the configuration half of the control centre.
 *
 * Everything here edits the database. Nothing here is live until the supervisor
 * admin publishes, so every screen carries the same reminder and the publish
 * screen shows exactly which files would change.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};
    var PRIVATE = '<p class="hint">Changes here are private. The site keeps showing the last published configuration until it is published from the Publish screen.</p>';

    function refresh(v, name) { return function () { views[name](v); }; }

    views.menus = function (v) {
      api.call('siteConfiguration').then(function (cfg) {
        var parents = cfg.menus.filter(function (m) { return m.menu === 'primary' && !m.parent; });
        v.innerHTML = '<h2>Navigation</h2><div class="card">' + PRIVATE + '</div>' +
          ['primary', 'footer'].map(function (which) {
            var rows = cfg.menus.filter(function (m) { return m.menu === which; });
            return '<div class="card"><h2>' + (which === 'primary' ? 'Main menu' : 'Footer') + '</h2>' +
              '<table><thead><tr><th>Name</th><th>Destination</th><th>Under</th><th>State</th><th></th></tr></thead><tbody>' +
              rows.map(function (m) {
                return '<tr><td>' + esc(m.name) + '</td><td class="hint">' + esc(m.url) + '</td>' +
                  '<td class="hint">' + esc(m.parent || '—') + '</td><td>' + esc(m.status) + '</td>' +
                  '<td><button class="ghost" data-cycle="' + esc(m.id) + '|' + esc(m.status) + '">' +
                  (m.status === 'ACTIVE' ? 'Pause' : 'Activate') + '</button></td></tr>';
              }).join('') + '</tbody></table></div>';
          }).join('') +
          '<div class="card"><h2>Add an item</h2>' +
          '<label for="mname">Name</label><input id="mname">' +
          '<label for="murl">Destination</label><input id="murl" placeholder="category.html?c=hydrogen">' +
          '<label for="mmenu">Menu</label><select id="mmenu"><option value="primary">Main menu</option><option value="footer">Footer</option></select>' +
          '<label for="mparent">Under</label><select id="mparent"><option value="">Top level</option>' +
          parents.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') +
          '</select><div class="rowbtns"><button class="act" id="addmenu">Add</button></div></div><div id="mmsg"></div>';

        v.querySelectorAll('[data-cycle]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = b.getAttribute('data-cycle').split('|');
            var item = cfg.menus.filter(function (m) { return m.id === p[0]; })[0];
            api.call('saveMenuItem', {
              id: item.id, menu: item.menu, name: item.name, url: item.url, parent: item.parent,
              order: item.order, status: p[1] === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
            }).then(refresh(v, 'menus'))
              .catch(function (e) { message(document.getElementById('mmsg'), explain(e), 'err'); });
          });
        });

        document.getElementById('addmenu').addEventListener('click', function () {
          api.call('saveMenuItem', {
            menu: document.getElementById('mmenu').value,
            name: document.getElementById('mname').value,
            url: document.getElementById('murl').value,
            parent: document.getElementById('mparent').value
          }).then(refresh(v, 'menus'))
            .catch(function (e) { message(document.getElementById('mmsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Navigation</h2>'; message(v, explain(e), 'err'); });
    };

    views.homepage = function (v) {
      api.call('siteConfiguration').then(function (cfg) {
        v.innerHTML = '<h2>Homepage</h2><div class="card">' + PRIVATE + '</div>' +
          '<div class="card"><table><thead><tr><th>Section</th><th>Type</th><th>Source</th><th>Items</th><th>State</th><th></th></tr></thead><tbody>' +
          cfg.homepage.map(function (s) {
            return '<tr><td>' + esc(s.title || s.section_id) + '<br><span class="hint">' + esc(s.section_id) +
              (s.starts ? ' · from ' + esc(String(s.starts).slice(0, 10)) : '') + '</span></td>' +
              '<td>' + esc(s.type) + '</td><td class="hint">' + esc(s.source) + '</td>' +
              '<td>' + (s.count || '—') + '</td><td>' + (s.active ? 'On' : 'Off') + '</td>' +
              '<td><button class="ghost" data-sec="' + esc(s.section_id) + '">' + (s.active ? 'Turn off' : 'Turn on') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="card"><h2>Add a section</h2>' +
          '<label for="sid">Identifier</label><input id="sid" placeholder="hydrogen-watch">' +
          '<label for="stitle">Heading</label><input id="stitle">' +
          '<label for="stype">Type</label><select id="stype">' +
          cfg.section_types.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' +
          '<label for="ssource">Source</label><input id="ssource" value="latest" placeholder="latest, manual, category:energy-storage">' +
          '<label for="scount">How many</label><input id="scount" type="number" value="4">' +
          '<label for="slayout">Layout</label><select id="slayout"><option>rows</option><option>grid</option><option>lead</option></select>' +
          '<div class="rowbtns"><button class="act" id="addsec">Add</button></div></div><div id="hmsg"></div>';

        v.querySelectorAll('[data-sec]').forEach(function (b) {
          b.addEventListener('click', function () {
            var s = cfg.homepage.filter(function (x) { return x.section_id === b.getAttribute('data-sec'); })[0];
            api.call('saveHomepageSection', Object.assign({}, s, { active: !s.active }))
              .then(refresh(v, 'homepage'))
              .catch(function (e) { message(document.getElementById('hmsg'), explain(e), 'err'); });
          });
        });

        document.getElementById('addsec').addEventListener('click', function () {
          api.call('saveHomepageSection', {
            section_id: document.getElementById('sid').value,
            title: document.getElementById('stitle').value,
            type: document.getElementById('stype').value,
            source: document.getElementById('ssource').value,
            count: Number(document.getElementById('scount').value),
            layout: document.getElementById('slayout').value, active: true
          }).then(refresh(v, 'homepage'))
            .catch(function (e) { message(document.getElementById('hmsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Homepage</h2>'; message(v, explain(e), 'err'); });
    };

    views.sections = function (v) {
      api.call('siteConfiguration').then(function (cfg) {
        v.innerHTML = '<h2>Sections and flags</h2><div class="card">' + PRIVATE + '</div>' +
          '<div class="card"><h2>Categories</h2><table><thead><tr><th>Name</th><th>Slug</th><th>Under</th><th>State</th><th></th></tr></thead><tbody>' +
          cfg.categories.map(function (c) {
            return '<tr><td>' + esc(c.name) + '<br><span class="hint">' + esc(c.description || '') + '</span></td>' +
              '<td><code>' + esc(c.slug) + '</code></td><td class="hint">' + esc(c.parent || '—') + '</td>' +
              '<td>' + esc(c.status) + '</td><td><button class="ghost" data-cat="' + esc(c.slug) + '">' +
              (c.status === 'ACTIVE' ? 'Retire' : 'Restore') + '</button></td></tr>';
          }).join('') + '</tbody></table>' +
          '<label for="cname">New category</label><input id="cname" placeholder="Hydrogen">' +
          '<label for="cparent">Under</label><select id="cparent"><option value="">Top level</option>' +
          cfg.categories.filter(function (c) { return !c.parent; })
            .map(function (c) { return '<option value="' + esc(c.slug) + '">' + esc(c.name) + '</option>'; }).join('') +
          '</select><label for="cdesc">One line for readers</label><input id="cdesc">' +
          '<div class="rowbtns"><button class="act" id="addcat">Add</button></div></div>' +

          '<div class="card"><h2>Feature flags</h2><table><tbody>' +
          cfg.features.map(function (f) {
            return '<tr><td><code>' + esc(f.flag) + '</code>' + (f.note ? '<br><span class="hint">' + esc(f.note) + '</span>' : '') + '</td>' +
              '<td>' + esc(f.state) + (f.starts ? ' from ' + esc(String(f.starts).slice(0, 10)) : '') + '</td>' +
              '<td>' + (f.locked ? '<span class="hint">locked by policy</span>'
                : '<button class="ghost" data-flag="' + esc(f.flag) + '|' + esc(f.state) + '">' +
                  (f.state === 'enabled' ? 'Turn off' : 'Turn on') + '</button>') + '</td></tr>';
          }).join('') + '</tbody></table></div><div id="cmsg"></div>';

        v.querySelectorAll('[data-cat]').forEach(function (b) {
          b.addEventListener('click', function () {
            var c = cfg.categories.filter(function (x) { return x.slug === b.getAttribute('data-cat'); })[0];
            api.call('saveCategory', Object.assign({}, c, { status: c.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }))
              .then(refresh(v, 'sections'))
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          });
        });
        document.getElementById('addcat').addEventListener('click', function () {
          var name = document.getElementById('cname').value;
          api.call('saveCategory', {
            slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name,
            parent: document.getElementById('cparent').value,
            description: document.getElementById('cdesc').value
          }).then(refresh(v, 'sections'))
            .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
        });
        v.querySelectorAll('[data-flag]').forEach(function (b) {
          b.addEventListener('click', function () {
            var p = b.getAttribute('data-flag').split('|');
            api.call('setFeatureFlag', { flag: p[0], state: p[1] === 'enabled' ? 'disabled' : 'enabled' })
              .then(refresh(v, 'sections'))
              .catch(function (e) { message(document.getElementById('cmsg'), explain(e), 'err'); });
          });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Sections and flags</h2>'; message(v, explain(e), 'err'); });
    };

    views.appearance = function (v) {
      api.call('siteConfiguration').then(function (cfg) {
        var s = cfg.settings, tokens = (s.appearance && s.appearance.tokens) || {};
        v.innerHTML = '<h2>Brand and appearance</h2><div class="card">' + PRIVATE + '</div>' +
          '<div class="card"><h2>Brand</h2>' +
          '<label for="bname">Name</label><input id="bname" value="' + esc(s.brand.name || '') + '">' +
          '<label for="btag">Tagline</label><input id="btag" value="' + esc(s.brand.tagline || '') + '">' +
          '<label for="bcontact">Editorial contact</label><input id="bcontact" value="' + esc((s.contact || {}).editorial || '') + '">' +
          '<div class="rowbtns"><button class="act" id="savebrand">Save</button></div></div>' +
          '<div class="card"><h2>Palette</h2>' +
          Object.keys(tokens).map(function (t) {
            return '<label for="t' + esc(t) + '">' + esc(t) + '</label>' +
              '<input id="t' + esc(t) + '" data-token="' + esc(t) + '" value="' + esc(tokens[t]) + '">';
          }).join('') +
          '<p class="hint">Colours only. A value with a semicolon or a url() is refused — these go straight into the page.</p>' +
          '<div class="rowbtns"><button class="act" id="savetokens">Save palette</button></div></div>' +
          '<div class="card"><h2>Social links in the footer</h2>' +
          '<p class="hint">These appear at the bottom of every page. Leave one blank to hide it — that is the off switch.</p>' +
          [['linkedin', 'LinkedIn', 'https://linkedin.com/company/…'],
           ['x', 'X', 'https://x.com/…'],
           ['facebook', 'Facebook', 'https://facebook.com/…'],
           ['instagram', 'Instagram', 'https://instagram.com/…'],
           ['youtube', 'YouTube', 'https://youtube.com/@…'],
           ['telegram', 'Telegram', 'https://t.me/…'],
           ['whatsapp', 'WhatsApp', 'https://wa.me/91…'],
           ['researchgate', 'ResearchGate', 'https://researchgate.net/profile/…'],
           ['email', 'Email', 'editor@sustech360.com'],
           ['rss', 'RSS', 'rss/feed.xml']].map(function (f) {
            return '<label for="s-' + f[0] + '">' + esc(f[1]) + '</label>' +
              '<input id="s-' + f[0] + '" data-social="' + f[0] + '" placeholder="' + esc(f[2]) + '" value="' +
              esc(((s.social || {})[f[0]]) || '') + '">';
          }).join('') +
          '<div class="rowbtns"><button class="act" id="savesocial">Save social links</button></div></div>' +

          '<div class="card"><h2>Analytics and ads</h2>' +
          '<label for="ga">GA4 measurement id</label><input id="ga" value="' + esc((s.analytics || {}).ga4_id || '') + '" placeholder="G-XXXXXXX">' +
          '<label for="adsense">AdSense client</label><input id="adsense" value="' + esc((s.ads || {}).adsense_client || '') + '" placeholder="ca-pub-…">' +
          '<div class="rowbtns"><button class="act" id="savemeasure">Save</button></div></div><div id="amsg"></div>';

        document.getElementById('savebrand').addEventListener('click', function () {
          api.call('saveSiteSettings', {
            brand: { name: document.getElementById('bname').value, tagline: document.getElementById('btag').value },
            contact: { editorial: document.getElementById('bcontact').value }
          }).then(function () { message(document.getElementById('amsg'), 'Saved. Publish to make it live.', 'ok'); })
            .catch(function (e) { message(document.getElementById('amsg'), explain(e), 'err'); });
        });
        document.getElementById('savetokens').addEventListener('click', function () {
          var out = {};
          v.querySelectorAll('[data-token]').forEach(function (i) { out[i.getAttribute('data-token')] = i.value; });
          api.call('saveSiteSettings', { tokens: out })
            .then(function () { message(document.getElementById('amsg'), 'Palette saved. Publish to make it live.', 'ok'); })
            .catch(function (e) { message(document.getElementById('amsg'), explain(e), 'err'); });
        });
        document.getElementById('savesocial').addEventListener('click', function () {
          var social = {};
          v.querySelectorAll('[data-social]').forEach(function (i) {
            social[i.getAttribute('data-social')] = i.value.trim();
          });
          api.call('saveSiteSettings', { social: social })
            .then(function () { message(document.getElementById('amsg'),
              'Saved. Publish to put them on the site.', 'ok'); })
            .catch(function (e) { message(document.getElementById('amsg'), explain(e), 'err'); });
        });

        document.getElementById('savemeasure').addEventListener('click', function () {
          api.call('saveSiteSettings', {
            analytics: { ga4_id: document.getElementById('ga').value },
            ads: { adsense_client: document.getElementById('adsense').value }
          }).then(function () { message(document.getElementById('amsg'), 'Saved.', 'ok'); })
            .catch(function (e) { message(document.getElementById('amsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Brand and appearance</h2>'; message(v, explain(e), 'err'); });
    };

    views.publish = function (v) {
      Promise.all([api.call('previewConfiguration'), api.call('configurationVersions')]).then(function (r) {
        var pv = r[0], versions = r[1];
        v.innerHTML = '<h2>Publish</h2>' +
          '<div class="card"><p>' + (pv.pending
            ? pv.pending + ' configuration file(s) differ from what is live.'
            : 'The live site matches the working configuration.') + '</p>' +
          '<table><tbody>' + pv.files.map(function (f) {
            return '<tr><td><code>' + esc(f.path) + '</code></td><td>' +
              (f.is_new ? 'new' : f.changed ? 'changed' : 'unchanged') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<label for="pnote">Note for the record</label><input id="pnote" placeholder="What changed and why">' +
          '<div class="rowbtns"><button class="act" id="dopub"' + (pv.pending ? '' : ' disabled') + '>Publish configuration</button></div>' +
          '<div id="pmsg"></div></div>' +
          '<div class="card"><h2>Published versions</h2><table><tbody>' +
          versions.map(function (x) {
            return '<tr><td>v' + x.version + (x.live ? ' <strong>live</strong>' : '') + '</td>' +
              '<td class="hint">' + esc(String(x.created_at).slice(0, 16).replace('T', ' ')) + ' ' + esc(x.note || '') + '</td>' +
              '<td>' + (x.live ? '' : '<button class="ghost" data-roll="' + x.version + '">Put back</button>' +
                ' <button class="ghost" data-adopt="' + x.version + '">Adopt</button>') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<p class="hint">Putting a version back changes the live site only. Adopting also resets the working copy to match it.</p></div>';

        document.getElementById('dopub').addEventListener('click', function () {
          if (!confirm('Publish the configuration to the live site?')) return;
          api.call('publishConfiguration', { note: document.getElementById('pnote').value })
            .then(function (res) { message(document.getElementById('pmsg'), 'Published as version ' + res.version + '.', 'ok');
              setTimeout(refresh(v, 'publish'), 800); })
            .catch(function (e) { message(document.getElementById('pmsg'), explain(e), 'err'); });
        });
        v.querySelectorAll('[data-roll]').forEach(function (b) {
          b.addEventListener('click', function () {
            var reason = prompt('Why is this version going back on the site?');
            if (!reason) return;
            api.call('rollbackConfiguration', { version: Number(b.getAttribute('data-roll')), reason: reason })
              .then(refresh(v, 'publish')).catch(function (e) { alert(explain(e)); });
          });
        });
        v.querySelectorAll('[data-adopt]').forEach(function (b) {
          b.addEventListener('click', function () {
            if (!confirm('Reset the working configuration to match version ' + b.getAttribute('data-adopt') + '? Unpublished edits are retired.')) return;
            api.call('adoptConfiguration', { version: Number(b.getAttribute('data-adopt')) })
              .then(refresh(v, 'publish')).catch(function (e) { alert(explain(e)); });
          });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Publish</h2>'; message(v, explain(e), 'err'); });
    };

    views.delegation = function (v) {
      Promise.all([api.call('listGrants'), api.call('listUsers')]).then(function (r) {
        var grants = r[0], users = r[1];
        v.innerHTML = '<h2>Delegated access</h2>' +
          '<div class="card"><p class="hint">Every grant ends by itself. Nothing here can reach FINAL_PUBLISH — that stays with the supervisor admin.</p>' +
          '<table><thead><tr><th>Person</th><th>Permission</th><th>Scope</th><th>Until</th><th>Why</th><th></th></tr></thead><tbody>' +
          grants.map(function (g) {
            return '<tr><td>' + esc(g.user) + '</td><td><code>' + esc(g.permission) + '</code></td>' +
              '<td>' + esc(g.scope) + '</td><td>' + esc(String(g.expires_at).slice(0, 16).replace('T', ' ')) +
              (g.active ? '' : ' <span class="hint">(ended)</span>') + '</td>' +
              '<td class="hint">' + esc(g.reason || '') + '</td>' +
              '<td>' + (g.active ? '<button class="danger" data-rev="' + esc(g.id) + '">End now</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="card"><h2>Delegate</h2>' +
          '<label for="gu">Person</label><select id="gu">' +
          users.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (' + esc(u.role_id) + ')</option>'; }).join('') +
          '</select>' +
          '<label for="gp">Permission</label><select id="gp">' +
          ['VIEW', 'CREATE', 'EDIT', 'REVIEW', 'APPROVE', 'PUBLISH_PREPARATION', 'ARCHIVE', 'EXPORT', 'MANAGE']
            .map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select>' +
          '<label for="gs">Scope</label><input id="gs" value="*" placeholder="* or a category slug">' +
          '<label for="ge">Until</label><input id="ge" type="date">' +
          '<label for="gr">Reason</label><input id="gr">' +
          '<div class="rowbtns"><button class="act" id="grant">Grant</button>' +
          '<button class="danger" id="emergency">Emergency access</button></div><div id="dmsg"></div></div>';

        v.querySelectorAll('[data-rev]').forEach(function (b) {
          b.addEventListener('click', function () {
            api.call('revokeGrant', { grant_id: b.getAttribute('data-rev'), reason: prompt('Why end it early?') || '' })
              .then(refresh(v, 'delegation')).catch(function (e) { alert(explain(e)); });
          });
        });
        document.getElementById('grant').addEventListener('click', function () {
          api.call('grantPermission', {
            user_id: document.getElementById('gu').value,
            permission: document.getElementById('gp').value,
            scope: document.getElementById('gs').value,
            expires_at: new Date(document.getElementById('ge').value + 'T23:59:59').toISOString(),
            reason: document.getElementById('gr').value
          }).then(refresh(v, 'delegation'))
            .catch(function (e) { message(document.getElementById('dmsg'), explain(e), 'err'); });
        });
        document.getElementById('emergency').addEventListener('click', function () {
          var hours = Number(prompt('How many hours? (capped at 24)'));
          if (!hours) return;
          api.call('emergencyAccess', {
            user_id: document.getElementById('gu').value,
            permission: document.getElementById('gp').value,
            scope: document.getElementById('gs').value,
            hours: hours, reason: document.getElementById('gr').value
          }).then(refresh(v, 'delegation'))
            .catch(function (e) { message(document.getElementById('dmsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Delegated access</h2>'; message(v, explain(e), 'err'); });
    };

    return views;
  };
})();
