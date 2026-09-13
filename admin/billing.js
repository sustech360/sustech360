/* billing.js — the billing screen.
 *
 * Amounts are held as whole minor units everywhere behind this screen, and
 * formatted only here. That is the one discipline that keeps a currency total
 * from drifting by a paisa per line until someone reconciles a bank statement.
 */
(function () {
  var previous = window.ADMIN_EXTRA_VIEWS;

  window.ADMIN_EXTRA_VIEWS = function (ctx) {
    var api = ctx.api, esc = ctx.esc, message = ctx.message, explain = ctx.explain;
    var views = previous ? previous(ctx) : {};

    function money(minor, currency) {
      var sign = minor < 0 ? '-' : '';
      var abs = Math.abs(Number(minor || 0));
      return sign + (currency || '') + ' ' + (abs / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function reload(v) { return function () { views.billing(v); }; }

    views.billing = function (v) {
      api.call('billing').then(function (b) {
        var cur = b.settings.currency;
        var owed = b.invoices.filter(function (i) { return i.balance > 0 && i.status !== 'VOID'; });
        var overdue = owed.filter(function (i) { return i.overdue; });
        var unverified = b.payments.filter(function (p) { return !p.verified_at; }).map(function (p) {
          var inv = b.invoices.filter(function (i) { return i.id === p.invoice_id; })[0];
          return Object.assign({ invoice_number: inv ? inv.number : p.invoice_id }, p);
        });

        v.innerHTML = '<h2>Billing</h2>' +
          '<div class="card"><table><tbody>' +
          '<tr><td>Outstanding</td><td><strong>' + esc(money(owed.reduce(function (n, i) { return n + i.balance; }, 0), cur)) + '</strong></td></tr>' +
          '<tr><td>Overdue</td><td>' + esc(money(overdue.reduce(function (n, i) { return n + i.balance; }, 0), cur)) +
          ' <span class="hint">(' + overdue.length + ' invoices)</span></td></tr>' +
          '<tr><td>Tax</td><td class="hint">' + esc(b.settings.tax_label) + ' · terms ' + b.settings.terms_days + ' days</td></tr>' +
          '</tbody></table>' +
          '<p class="hint">This platform records money; it does not move any. No card details are ever taken or stored here.</p></div>' +

          '<div class="card"><h2>Invoices</h2><table><thead><tr>' +
          '<th>Number</th><th>Customer</th><th>Total</th><th>Outstanding</th><th>State</th><th></th></tr></thead><tbody>' +
          b.invoices.map(function (i) {
            return '<tr><td>' + esc(i.number) + '<br><span class="hint">' +
              esc(String(i.issued_at).slice(0, 10)) + (i.due_at ? ' · due ' + esc(String(i.due_at).slice(0, 10)) : '') + '</span></td>' +
              '<td>' + esc(i.customer) + '</td><td>' + esc(money(i.total, i.currency)) + '</td>' +
              '<td>' + esc(i.balance > 0 ? money(i.balance, i.currency) : '—') + '</td>' +
              '<td>' + esc(i.status) + '</td>' +
              '<td>' + (i.balance > 0 && !i.is_credit_note ? '<button class="ghost" data-pay="' + esc(i.id) + '|' + i.balance + '">Record payment</button> ' : '') +
              (i.status !== 'VOID' && !i.credit_of ? '<button class="ghost" data-credit="' + esc(i.id) + '">Credit note</button> ' : '') +
              (i.status === 'ISSUED' && !i.paid ? '<button class="danger" data-void="' + esc(i.id) + '">Void</button>' : '') +
              '</td></tr>';
          }).join('') + '</tbody></table></div>' +

          (unverified.length ? '<div class="card"><h2>Payments to confirm</h2>' +
            '<p class="hint">Whoever recorded a payment cannot confirm it. Check the bank, then confirm.</p>' +
            '<table><tbody>' + unverified.map(function (p) {
              return '<tr><td>' + esc(p.invoice_number) + '</td><td>' + esc(money(p.amount, cur)) + '</td>' +
                '<td class="hint">' + esc(p.method) + ' ' + esc(p.reference || '') + '</td>' +
                '<td><button class="act" data-verify="' + esc(p.id) + '">Confirm</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '') +

          '<div class="card"><h2>Orders not yet invoiced</h2><table><tbody>' +
          b.orders.filter(function (o) { return o.status === 'CONFIRMED'; }).map(function (o) {
            return '<tr><td>' + esc(o.customer) + '<br><span class="hint">' + esc(o.id) + '</span></td>' +
              '<td>' + esc(money(o.total, o.currency)) + '</td>' +
              '<td><button class="act" data-invoice="' + esc(o.id) + '">Issue the invoice</button></td></tr>';
          }).join('') + '</tbody></table></div>' +

          '<div class="card"><h2>New order</h2>' +
          '<label for="ocust">Customer</label><select id="ocust">' +
          b.customers.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
          '<label for="oprod">Package</label><select id="oprod">' +
          b.products.map(function (p) {
            return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' — ' + esc(money(p.unit_price, cur)) + '</option>';
          }).join('') + '</select>' +
          '<label for="oqty">Quantity</label><input id="oqty" type="number" value="1">' +
          '<label for="oprice">Agreed unit price <span class="hint">(leave blank for the list price)</span></label>' +
          '<input id="oprice" placeholder="e.g. 35000.00">' +
          '<label for="ocamp">Campaign <span class="hint">(optional)</span></label><select id="ocamp">' +
          '<option value="">None</option>' +
          b.campaigns.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
          '</select><div class="rowbtns"><button class="act" id="mkorder">Create the order</button></div></div>' +

          '<div class="card"><h2>Customers and packages</h2>' +
          '<table><tbody>' + b.customers.map(function (c) {
            return '<tr><td>' + esc(c.name) + '<br><span class="hint">' + esc(c.email) + '</span></td>' +
              '<td class="hint">' + esc(c.tax_id || 'no tax id') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<label for="cname">New customer</label><input id="cname">' +
          '<label for="cemail">Accounts email</label><input id="cemail" type="email">' +
          '<label for="caddr">Billing address</label><input id="caddr">' +
          '<label for="ctax">Tax id</label><input id="ctax">' +
          '<div class="rowbtns"><button class="ghost" id="mkcust">Add the customer</button></div></div><div id="bmsg"></div>';

        v.querySelectorAll('[data-invoice]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (!confirm('Issue the invoice? It is numbered, emailed and cannot be edited afterwards.')) return;
            api.call('issueInvoice', { order_id: btn.getAttribute('data-invoice') })
              .then(function (r) { message(document.getElementById('bmsg'), 'Issued ' + r.number + '.', 'ok'); setTimeout(reload(v), 700); })
              .catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-pay]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var parts = btn.getAttribute('data-pay').split('|');
            var amount = prompt('Amount received (outstanding: ' + money(Number(parts[1]), cur) + ')');
            if (!amount) return;
            api.call('recordPayment', {
              invoice_id: parts[0], amount: Math.round(Number(amount) * 100),
              method: prompt('Method (TRANSFER, UPI, CHEQUE):') || 'TRANSFER',
              reference: prompt('Bank reference:') || ''
            }).then(reload(v)).catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-verify]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            api.call('verifyPayment', { payment_id: btn.getAttribute('data-verify') })
              .then(reload(v)).catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-void]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var reason = prompt('Why should this invoice never have existed?');
            if (!reason) return;
            api.call('voidInvoice', { invoice_id: btn.getAttribute('data-void'), reason: reason })
              .then(reload(v)).catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
          });
        });
        v.querySelectorAll('[data-credit]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var reason = prompt('What is being credited, and why?');
            if (!reason) return;
            var amount = prompt('Amount to credit (blank for the whole invoice):');
            api.call('creditNote', {
              invoice_id: btn.getAttribute('data-credit'), reason: reason,
              amount: amount ? Math.round(Number(amount) * 100) : undefined
            }).then(reload(v)).catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
          });
        });
        document.getElementById('mkorder').addEventListener('click', function () {
          var price = document.getElementById('oprice').value;
          api.call('createOrder', {
            customer_id: document.getElementById('ocust').value,
            campaign_id: document.getElementById('ocamp').value,
            lines: [{
              product_id: document.getElementById('oprod').value,
              quantity: Number(document.getElementById('oqty').value),
              unit_price: price ? Math.round(Number(price) * 100) : undefined
            }]
          }).then(reload(v)).catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
        });
        document.getElementById('mkcust').addEventListener('click', function () {
          api.call('saveCustomer', {
            name: document.getElementById('cname').value,
            email: document.getElementById('cemail').value,
            billing_address: document.getElementById('caddr').value,
            tax_id: document.getElementById('ctax').value
          }).then(reload(v)).catch(function (e) { message(document.getElementById('bmsg'), explain(e), 'err'); });
        });
      }).catch(function (e) { v.innerHTML = '<h2>Billing</h2>'; message(v, explain(e), 'err'); });
    };

    return views;
  };
})();
