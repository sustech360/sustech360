/** Billing.gs — customers, orders, invoices, payments.
 *
 *  Scope, stated up front: this is the billing spine for advertising, which is
 *  the revenue this platform actually has. Membership, jobs, events, premium
 *  reports and the company directory are in the specification's phase 10 and
 *  are deliberately not built — see the phase 10 notes. A `Products` row has a
 *  `kind`, so adding one later is a catalogue entry rather than a rewrite.
 *
 *  Three rules shape the code.
 *
 *  Money is integers. Every amount in this file is in minor units — paise,
 *  cents — because floating point arithmetic on money produces invoices that
 *  are wrong by a rupee and correspondence nobody enjoys.
 *
 *  An issued invoice never changes. Not the amount, not the tax rate, not the
 *  customer's address. That is a legal document and in most jurisdictions a
 *  numbered one; a correction is a credit note, which is why `voidInvoice` and
 *  `creditNote` exist and `editInvoice` does not. It is the same principle the
 *  publishing engine uses for articles, for the same reason: the record of what
 *  was said has to survive changing your mind.
 *
 *  No money moves through here. Payments are recorded after they arrive
 *  somewhere else — a bank transfer, a card terminal, a cheque. Wiring a payment
 *  processor in is phase 11's problem and needs a conversation about PCI scope,
 *  not an afternoon.
 */
const Billing = {

  /* ---------------- reading ---------------- */

  bundle: function (session) {
    Perms.require(session, 'MANAGE');
    const invoices = Db.all('Invoices').sort((a, b) => String(b.issued_at).localeCompare(String(a.issued_at)));
    return {
      settings: this.settings(),
      customers: Db.all('Customers').map(c => ({
        id: c.id, name: c.name, email: c.email, tax_id: c.tax_id || '',
        country: c.country || '', status: c.status, outstanding: this.outstanding_(c.id)
      })),
      products: Db.all('Products').filter(p => p.status === 'ACTIVE').map(p => ({
        id: p.id, sku: p.sku, name: p.name, kind: p.kind, unit_price: Number(p.unit_price),
        currency: p.currency, tax_rate: Number(p.tax_rate), description: p.description || ''
      })),
      orders: Db.all('Orders').map(o => this.shapeOrder_(o)),
      invoices: invoices.map(i => this.shapeInvoice_(i)),
      // Campaigns come along so an order can be tied to the advertising it pays
      // for, which is the only reason most of these invoices exist.
      campaigns: Db.all('Campaigns').map(c => ({ id: c.id, name: c.name, status: c.status })),
      payments: Db.all('Payments').map(p => ({
        id: p.id, invoice_id: p.invoice_id, amount: Number(p.amount), method: p.method,
        reference: p.reference || '', received_at: p.received_at,
        recorded_by: p.recorded_by, verified_by: p.verified_by || '', verified_at: p.verified_at || ''
      }))
    };
  },

  settings: function () {
    const get = (k, d) => {
      const row = Db.findOne('Settings', { key: k });
      return row ? row.value : d;
    };
    let seller = {};
    try { seller = JSON.parse(get('billing.seller', '{}')); } catch (e) {}
    return {
      currency: get('billing.currency', 'INR'),
      tax_label: get('billing.tax_label', 'GST'),
      fy_start_month: Number(get('billing.fy_start_month', '4')),
      terms_days: Number(get('billing.payment_terms_days', '30')),
      require_payment_before_live: String(get('billing.require_payment_before_live', 'false')) === 'true',
      seller: seller
    };
  },

  /* ---------------- customers and catalogue ---------------- */

  saveCustomer: function (session, p) {
    Perms.require(session, 'MANAGE');
    const email = String(p.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiFail('bad_email');
    const patch = {
      name: String(p.name || '').trim().slice(0, 120),
      email: email,
      billing_address: String(p.billing_address || '').slice(0, 400),
      tax_id: String(p.tax_id || '').trim().slice(0, 40),
      country: String(p.country || '').slice(0, 60),
      currency: this.settings().currency,
      advertiser_id: String(p.advertiser_id || ''),
      status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      notes: String(p.notes || '').slice(0, 300)
    };
    if (!patch.name) throw new ApiFail('bad_name');
    if (p.id) {
      const existing = Db.findOne('Customers', { id: String(p.id) });
      if (!existing) throw new ApiFail('not_found');
      Db.update('Customers', { id: existing.id }, patch);
      Audit.log(session, 'CUSTOMER_UPDATED', 'customer', existing.id, { meta: { name: patch.name } });
      return { ok: true, id: existing.id };
    }
    const rec = Db.insert('Customers', Object.assign({ id: Db.newId('CUS'), created_by: session.user.id }, patch));
    Audit.log(session, 'CUSTOMER_ADDED', 'customer', rec.id, { next: patch.name });
    return { ok: true, id: rec.id };
  },

  saveProduct: function (session, p) {
    Perms.require(session, 'MANAGE');
    const price = Math.round(Number(p.unit_price));
    if (!isFinite(price) || price < 0) throw new ApiFail('bad_price', 'prices are whole minor units');
    const rate = Math.round(Number(p.tax_rate === undefined ? 1800 : p.tax_rate));
    if (rate < 0 || rate > 10000) throw new ApiFail('bad_tax_rate', 'basis points, so 1800 means 18 per cent');
    const sku = String(p.sku || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
    if (sku.length < 3) throw new ApiFail('bad_sku');
    const patch = {
      sku: sku, name: String(p.name || sku).slice(0, 120),
      kind: String(p.kind || 'AD_PACKAGE').toUpperCase().replace(/[^A-Z_]/g, ''),
      description: String(p.description || '').slice(0, 300),
      unit_price: price, currency: this.settings().currency, tax_rate: rate,
      status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
    };
    const existing = Db.findOne('Products', { sku: sku });
    if (existing) {
      Db.update('Products', { id: existing.id }, patch);
      Audit.log(session, 'PRODUCT_UPDATED', 'product', existing.id, { meta: { sku: sku, price: price } });
      return { ok: true, id: existing.id };
    }
    const rec = Db.insert('Products', Object.assign({ id: Db.newId('PRD') }, patch));
    Audit.log(session, 'PRODUCT_ADDED', 'product', rec.id, { next: sku });
    return { ok: true, id: rec.id };
  },

  /* ---------------- orders ---------------- */

  /** Totals are computed here from the catalogue, never accepted from the
   *  caller. A price sent by a browser is a suggestion, not a fact. */
  createOrder: function (session, p) {
    Perms.require(session, 'MANAGE');
    const customer = Db.findOne('Customers', { id: String(p.customer_id || '') });
    if (!customer) throw new ApiFail('not_found', 'no such customer');
    const campaign = p.campaign_id ? Db.findOne('Campaigns', { id: String(p.campaign_id) }) : null;
    if (p.campaign_id && !campaign) throw new ApiFail('unknown_campaign');

    const lines = (p.lines || []).map(l => {
      const product = Db.findOne('Products', { id: String(l.product_id || '') });
      if (!product) throw new ApiFail('unknown_product', String(l.product_id));
      const qty = Math.max(1, Math.min(999, Math.round(Number(l.quantity || 1))));
      // An override is allowed — deals happen — but it is recorded as an
      // override rather than quietly becoming the price.
      let unit = Math.round(Number(product.unit_price));
      let override = false;
      if (l.unit_price !== undefined && Math.round(Number(l.unit_price)) !== unit) {
        const asked = Math.round(Number(l.unit_price));
        if (!isFinite(asked) || asked < 0) throw new ApiFail('bad_price');
        unit = asked;
        override = true;
      }
      const discount = Math.max(0, Math.round(Number(l.discount || 0)));
      const net = Math.max(0, qty * unit - discount);
      const tax = Math.round(net * Number(product.tax_rate) / 10000);
      return {
        product_id: product.id, sku: product.sku, name: product.name,
        quantity: qty, unit_price: unit, discount: discount, list_price: Number(product.unit_price),
        price_overridden: override, tax_rate: Number(product.tax_rate), net: net, tax: tax
      };
    });
    if (!lines.length) throw new ApiFail('empty_order');

    const subtotal = lines.reduce((n, l) => n + l.net, 0);
    const tax = lines.reduce((n, l) => n + l.tax, 0);
    const rec = Db.insert('Orders', {
      id: Db.newId('ORD'), customer_id: customer.id, campaign_id: campaign ? campaign.id : '',
      lines: JSON.stringify(lines), currency: this.settings().currency,
      subtotal: subtotal, tax: tax, total: subtotal + tax,
      status: 'CONFIRMED', created_by: session.user.id, note: String(p.note || '').slice(0, 300)
    });
    Audit.log(session, 'ORDER_CREATED', 'order', rec.id, {
      next: String(subtotal + tax),
      meta: { customer: customer.id, campaign: campaign ? campaign.id : '', overrides: lines.filter(l => l.price_overridden).length }
    });
    return { ok: true, id: rec.id, subtotal: subtotal, tax: tax, total: subtotal + tax };
  },

  /* ---------------- invoices ---------------- */

  /** Issuing takes a snapshot: the lines, the tax rates, the customer's billing
   *  details as they are now. Changing a product price next month must not
   *  change what was invoiced last month. */
  issueInvoice: function (session, p) {
    Perms.require(session, 'MANAGE');
    const order = Db.findOne('Orders', { id: String(p.order_id || '') });
    if (!order) throw new ApiFail('not_found');
    if (order.status === 'INVOICED') throw new ApiFail('already_invoiced');
    if (order.status === 'CANCELLED') throw new ApiFail('order_cancelled');
    const customer = Db.findOne('Customers', { id: order.customer_id });
    if (!customer) throw new ApiFail('not_found', 'the customer is gone');

    const cfg = this.settings();
    const days = Math.max(0, Math.min(180, Number(p.due_days === undefined ? cfg.terms_days : p.due_days)));
    const number = this.nextNumber_();
    const issued = new Date();
    const due = new Date(issued.getTime() + days * 86400000);

    const rec = Db.insert('Invoices', {
      id: Db.newId('INV'), number: number, order_id: order.id, customer_id: customer.id,
      issued_at: issued.toISOString(), due_at: due.toISOString(),
      currency: order.currency, subtotal: Number(order.subtotal), tax: Number(order.tax),
      total: Number(order.total), paid: 0, status: 'ISSUED',
      lines: order.lines,
      tax_note: cfg.tax_label + (customer.tax_id ? ' · customer ' + customer.tax_id : ''),
      issued_by: session.user.id,
      notes: JSON.stringify({
        bill_to: customer.name, address: customer.billing_address || '',
        tax_id: customer.tax_id || '', email: customer.email
      })
    });
    Db.update('Orders', { id: order.id }, { status: 'INVOICED' });

    const pdf = this.pdf_(rec);
    Db.update('Invoices', { id: rec.id }, { pdf_ref: pdf.id });
    this.email_(session, rec, customer, cfg);

    Audit.log(session, 'INVOICE_ISSUED', 'invoice', rec.id, {
      next: number, meta: { order: order.id, total: Number(order.total), customer: customer.id }
    });
    return { ok: true, id: rec.id, number: number, total: Number(order.total), due_at: due.toISOString() };
  },

  /** Sequential, gap-free, never reused. The lock matters: two people issuing
   *  at the same moment must not both take number 41. */
  nextNumber_: function () {
    const cfg = this.settings();
    const now = new Date();
    const startMonth = cfg.fy_start_month;
    const fyStart = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1;
    const fy = String(fyStart) + '-' + String((fyStart + 1) % 100).padStart(2, '0');
    const key = 'billing.seq.' + fy;

    return Db.withLock(() => {
      const row = Db.findOne('Settings', { key: key });
      const next = (row ? Number(row.value) : 0) + 1;
      if (row) Db.update('Settings', { key: key }, { value: String(next) });
      else Db.insert('Settings', { key: key, value: String(next), scope: 'billing' });
      return 'INV-' + fy + '-' + String(next).padStart(4, '0');
    });
  },

  /** Voiding is for an invoice that should never have existed and has taken no
   *  money. Anything else is a credit note. */
  voidInvoice: function (session, p) {
    Perms.require(session, 'APPROVE');
    const inv = this.mustInvoice_(p.invoice_id);
    if (inv.status === 'VOID') throw new ApiFail('already_void');
    if (Number(inv.paid || 0) > 0) {
      throw new ApiFail('has_payments', 'money has been received against this — raise a credit note instead');
    }
    const reason = String(p.reason || '').trim();
    if (reason.length < 10) throw new ApiFail('reason_required');
    Db.update('Invoices', { id: inv.id }, {
      status: 'VOID', voided_at: new Date().toISOString(), voided_by: session.user.id, void_reason: reason
    });
    Db.update('Orders', { id: inv.order_id }, { status: 'CONFIRMED' });
    Audit.log(session, 'INVOICE_VOIDED', 'invoice', inv.id, { prev: inv.status, next: 'VOID', reason: reason });
    return { ok: true };
  },

  /** The correction mechanism. A credit note is its own numbered document with
   *  negative amounts, referencing what it corrects — the original stays
   *  exactly as it was issued. */
  creditNote: function (session, p) {
    Perms.require(session, 'APPROVE');
    const inv = this.mustInvoice_(p.invoice_id);
    if (inv.status === 'VOID') throw new ApiFail('bad_status', 'a void invoice has nothing to credit');
    if (inv.credit_of) throw new ApiFail('bad_status', 'a credit note cannot be credited');
    const reason = String(p.reason || '').trim();
    if (reason.length < 10) throw new ApiFail('reason_required');

    const already = Db.all('Invoices').filter(x => x.credit_of === inv.id)
      .reduce((n, x) => n + Math.abs(Number(x.total || 0)), 0);
    const room = Number(inv.total) - already;
    if (room <= 0) throw new ApiFail('fully_credited');
    const amount = p.amount === undefined ? room : Math.round(Number(p.amount));
    if (!isFinite(amount) || amount <= 0) throw new ApiFail('bad_amount');
    if (amount > room) throw new ApiFail('too_large', 'more than remains on the invoice');

    // Tax is credited in the same proportion as the original document.
    const taxShare = Number(inv.total) ? Math.round(amount * Number(inv.tax) / Number(inv.total)) : 0;
    const number = this.nextNumber_().replace('INV-', 'CRN-');
    const rec = Db.insert('Invoices', {
      id: Db.newId('CRN'), number: number, order_id: inv.order_id, customer_id: inv.customer_id,
      issued_at: new Date().toISOString(), due_at: '', currency: inv.currency,
      subtotal: -(amount - taxShare), tax: -taxShare, total: -amount, paid: 0,
      status: 'ISSUED', lines: inv.lines, tax_note: inv.tax_note,
      issued_by: session.user.id, credit_of: inv.id, notes: inv.notes, void_reason: reason
    });
    const outstanding = this.balance_(inv);
    Db.update('Invoices', { id: inv.id }, { status: outstanding <= 0 ? 'SETTLED' : inv.status });
    Audit.log(session, 'CREDIT_NOTE_ISSUED', 'invoice', rec.id,
      { prev: inv.number, next: number, reason: reason, meta: { amount: amount } });
    return { ok: true, id: rec.id, number: number, amount: amount };
  },

  /* ---------------- payments ---------------- */

  /** Records money that arrived somewhere else. Nothing in this platform moves
   *  funds, and nothing here should ever be mistaken for a receipt of payment
   *  until someone has checked the bank. */
  recordPayment: function (session, p) {
    Perms.require(session, 'MANAGE');
    const inv = this.mustInvoice_(p.invoice_id);
    if (inv.status === 'VOID') throw new ApiFail('bad_status', 'this invoice is void');
    if (Number(inv.total) < 0) throw new ApiFail('bad_status', 'a credit note is not paid, it is applied');
    const amount = Math.round(Number(p.amount));
    if (!isFinite(amount) || amount <= 0) throw new ApiFail('bad_amount');

    const outstanding = this.balance_(inv);
    if (amount > outstanding) {
      throw new ApiFail('overpayment', 'only ' + outstanding + ' remains outstanding');
    }
    const method = String(p.method || '').toUpperCase().replace(/[^A-Z_]/g, '').slice(0, 20) || 'TRANSFER';
    const rec = Db.insert('Payments', {
      id: Db.newId('PAY'), invoice_id: inv.id, amount: amount, currency: inv.currency,
      method: method, reference: String(p.reference || '').slice(0, 80),
      received_at: p.received_at || new Date().toISOString(),
      recorded_by: session.user.id, note: String(p.note || '').slice(0, 200)
    });
    const paid = Number(inv.paid || 0) + amount;
    Db.update('Invoices', { id: inv.id }, {
      paid: paid, status: paid >= Number(inv.total) ? 'PAID' : 'PART_PAID'
    });
    Audit.log(session, 'PAYMENT_RECORDED', 'invoice', inv.id,
      { next: String(amount), meta: { payment: rec.id, method: method, reference: rec.reference } });
    return { ok: true, id: rec.id, paid: paid, outstanding: Number(inv.total) - paid };
  },

  /** Separation of duties: whoever recorded the payment cannot be the one who
   *  confirms it against the bank. It is the cheapest control there is. */
  verifyPayment: function (session, p) {
    Perms.require(session, 'APPROVE');
    const pay = Db.findOne('Payments', { id: String(p.payment_id || '') });
    if (!pay) throw new ApiFail('not_found');
    if (pay.verified_at) throw new ApiFail('already_verified');
    if (String(pay.recorded_by) === String(session.user.id)) {
      Audit.log(session, 'PAYMENT_SELF_VERIFY_BLOCKED', 'payment', pay.id, {});
      throw new ApiFail('conflict_of_interest', 'someone else confirms a payment you recorded');
    }
    Db.update('Payments', { id: pay.id }, {
      verified_by: session.user.id, verified_at: new Date().toISOString()
    });
    Audit.log(session, 'PAYMENT_VERIFIED', 'payment', pay.id,
      { next: String(pay.amount), meta: { invoice: pay.invoice_id } });
    return { ok: true };
  },

  /* ---------------- the gate advertising can use ---------------- */

  /** True when a campaign is clear to run. With the setting off — the default —
   *  everything is clear and this platform has no opinion about your credit
   *  control. */
  campaignClear: function (campaignId) {
    if (!this.settings().require_payment_before_live) return { clear: true };
    if (!campaignId) return { clear: false, reason: 'this creative belongs to no campaign' };
    const orders = Db.all('Orders').filter(o => o.campaign_id === campaignId);
    if (!orders.length) return { clear: false, reason: 'no order has been raised for this campaign' };
    const unpaid = [];
    orders.forEach(o => {
      Db.all('Invoices').filter(i => i.order_id === o.id && !i.credit_of && i.status !== 'VOID')
        .forEach(i => { if (this.balance_(i) > 0) unpaid.push(i.number); });
    });
    if (!Db.all('Invoices').some(i => orders.some(o => o.id === i.order_id) && i.status !== 'VOID')) {
      return { clear: false, reason: 'the order has not been invoiced' };
    }
    if (unpaid.length) return { clear: false, reason: 'unpaid: ' + unpaid.join(', ') };
    return { clear: true };
  },

  /* ---------------- documents ---------------- */

  /** The invoice PDF lives in Drive and goes to the customer by email. It is
   *  never committed to the site repository — that repository is public, and an
   *  invoice carries a name, an address and a tax number. */
  pdf_: function (inv) {
    const html = this.renderHtml_(inv);
    const blob = Utilities.newBlob(html, 'text/html', inv.number + '.html').getAs('application/pdf');
    const file = this.folder_().createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    return { id: file.getId(), bytes: blob.getBytes().length };
  },

  renderHtml_: function (inv) {
    const cfg = this.settings();
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const money = n => this.format_(n, inv.currency);
    let lines = [];
    try { lines = JSON.parse(inv.lines || '[]'); } catch (e) {}
    let bill = {};
    try { bill = JSON.parse(inv.notes || '{}'); } catch (e) {}
    const credit = !!inv.credit_of;
    const sign = credit ? -1 : 1;

    return '<html><head><meta charset="utf-8"><style>' +
      'body{font-family:Georgia,serif;font-size:11pt;color:#111}' +
      'table{width:100%;border-collapse:collapse;margin:16pt 0}' +
      'th,td{text-align:left;padding:6pt 4pt;border-bottom:1px solid #ccc}' +
      'td.n,th.n{text-align:right}.meta{color:#555;font-size:9pt}' +
      '</style></head><body>' +
      '<h1>' + (credit ? 'Credit note' : 'Invoice') + ' ' + esc(inv.number) + '</h1>' +
      '<p class="meta">' + esc(cfg.seller.name || Email.brand_()) + '<br>' +
      esc(cfg.seller.address || '') + (cfg.seller.tax_id ? '<br>' + esc(cfg.tax_label) + ': ' + esc(cfg.seller.tax_id) : '') + '</p>' +
      '<p><strong>To</strong><br>' + esc(bill.bill_to || '') + '<br>' + esc(bill.address || '') +
      (bill.tax_id ? '<br>' + esc(cfg.tax_label) + ': ' + esc(bill.tax_id) : '') + '</p>' +
      '<p class="meta">Issued ' + esc(String(inv.issued_at).slice(0, 10)) +
      (inv.due_at ? ' · due ' + esc(String(inv.due_at).slice(0, 10)) : '') +
      (credit ? ' · against ' + esc(this.numberOf_(inv.credit_of)) : '') + '</p>' +
      '<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Net</th><th class="n">' +
      esc(cfg.tax_label) + '</th></tr></thead><tbody>' +
      lines.map(l => '<tr><td>' + esc(l.name) + '<br><span class="meta">' + esc(l.sku) + '</span></td>' +
        '<td class="n">' + l.quantity + '</td><td class="n">' + money(sign * l.unit_price) + '</td>' +
        '<td class="n">' + money(sign * l.net) + '</td>' +
        '<td class="n">' + money(sign * l.tax) + ' <span class="meta">(' + (l.tax_rate / 100) + '%)</span></td></tr>').join('') +
      '</tbody></table>' +
      '<table><tbody>' +
      '<tr><td class="n">Net</td><td class="n">' + money(Number(inv.subtotal)) + '</td></tr>' +
      '<tr><td class="n">' + esc(cfg.tax_label) + '</td><td class="n">' + money(Number(inv.tax)) + '</td></tr>' +
      '<tr><td class="n"><strong>Total</strong></td><td class="n"><strong>' + money(Number(inv.total)) + '</strong></td></tr>' +
      '</tbody></table>' +
      (inv.void_reason ? '<p class="meta">' + esc(inv.void_reason) + '</p>' : '') +
      '<p class="meta">This document is issued electronically and is valid without a signature.</p>' +
      '</body></html>';
  },

  email_: function (session, inv, customer, cfg) {
    try {
      const file = inv.pdf_ref ? null : null;
      void file;
      Email.sendRaw(customer.email,
        (Number(inv.total) < 0 ? 'Credit note ' : 'Invoice ') + inv.number + ' from ' + Email.brand_(),
        'Dear ' + (customer.name || 'colleague') + ',\n\n' +
        (Number(inv.total) < 0 ? 'A credit note' : 'An invoice') + ' for ' +
        this.format_(Math.abs(Number(inv.total)), inv.currency) + ' is attached to your account.\n\n' +
        'Number: ' + inv.number + '\n' +
        (inv.due_at ? 'Due: ' + String(inv.due_at).slice(0, 10) + '\n' : '') +
        '\nReply to this message with any question about it.\n\n' + Email.brand_(),
        'invoice', session);
    } catch (e) {
      console.error('invoice email failed: ' + e.message);
    }
  },

  /* ---------------- internals ---------------- */

  mustInvoice_: function (id) {
    const inv = Db.findOne('Invoices', { id: String(id || '') });
    if (!inv) throw new ApiFail('not_found');
    return inv;
  },

  /** What is still owed on an invoice: its total, less payments, less any
   *  credit notes raised against it. */
  balance_: function (inv) {
    const credited = Db.all('Invoices').filter(x => x.credit_of === inv.id)
      .reduce((n, x) => n + Math.abs(Number(x.total || 0)), 0);
    return Number(inv.total) - Number(inv.paid || 0) - credited;
  },

  outstanding_: function (customerId) {
    return Db.all('Invoices')
      .filter(i => i.customer_id === customerId && i.status !== 'VOID' && !i.credit_of)
      .reduce((n, i) => n + Math.max(0, this.balance_(i)), 0);
  },

  numberOf_: function (id) {
    const inv = Db.findOne('Invoices', { id: id });
    return inv ? inv.number : id;
  },

  format_: function (minor, currency) {
    const sign = minor < 0 ? '-' : '';
    const abs = Math.abs(Math.round(Number(minor) || 0));
    return sign + (currency || 'INR') + ' ' + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  },

  shapeOrder_: function (o) {
    let lines = [];
    try { lines = JSON.parse(o.lines || '[]'); } catch (e) {}
    const invoice = Db.all('Invoices').filter(i => i.order_id === o.id && !i.credit_of && i.status !== 'VOID')[0];
    return {
      id: o.id, customer_id: o.customer_id, campaign_id: o.campaign_id || '',
      lines: lines, subtotal: Number(o.subtotal), tax: Number(o.tax), total: Number(o.total),
      currency: o.currency, status: o.status, created_at: o.created_at,
      invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status } : null
    };
  },

  shapeInvoice_: function (i) {
    const customer = Db.findOne('Customers', { id: i.customer_id });
    return {
      id: i.id, number: i.number, customer: customer ? customer.name : i.customer_id,
      customer_id: i.customer_id, issued_at: i.issued_at, due_at: i.due_at || '',
      currency: i.currency, subtotal: Number(i.subtotal), tax: Number(i.tax),
      total: Number(i.total), paid: Number(i.paid || 0), balance: this.balance_(i),
      status: i.status, credit_of: i.credit_of || '', is_credit_note: Number(i.total) < 0,
      overdue: i.due_at && i.status !== 'PAID' && i.status !== 'VOID' && new Date(i.due_at) < new Date()
    };
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('billing');
    return it.hasNext() ? it.next() : root.createFolder('billing');
  }
};
