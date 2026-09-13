/* tests/phase10.js — billing.
 *
 * Money code earns the most adversarial tests in the project, because its
 * failures are quiet: a rounding error is a discrepancy nobody notices until an
 * auditor does, a reused invoice number is a compliance problem, and an edited
 * invoice is a document that says something different from the copy the
 * customer has in their inbox.
 *
 *   node tests/phase10.js
 */
const { build, test, assert, throwsWith, done } = require('./harness');

const sandbox = build({
  ENV: 'test',
  SPREADSHEET_ID: 'sheet',
  DRIVE_FOLDER_ID: 'folder',
  PASSWORD_PEPPER: 'pepper-for-tests-only',
  TOKEN_PEPPER: 'token-pepper-for-tests-only',
  SITE_URL: 'https://example.test/magazine/',
  GITHUB_REPO: 'owner/repo',
  GITHUB_TOKEN: 'unused',
  BOOTSTRAP_EMAIL: 'supervisor@example.test'
});

const { outbox, repo } = sandbox;
const Db = sandbox.internals.Db;

function call(action, payload, token) {
  const res = sandbox.doPost({ postData: { contents: JSON.stringify({ action, token: token || null, payload: payload || {} }) } });
  const out = JSON.parse(res.getContent());
  if (out.ok) return out.data;
  const err = new Error(out.error + (out.detail ? ': ' + out.detail : ''));
  err.code = out.error;
  err.detail = out.detail;
  throw err;
}
function tempPasswordFor(email) {
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (outbox[i].to === email) {
      const m = (outbox[i].body || '').match(/Temporary password: (\S+)/);
      if (m) return m[1];
    }
  }
  return null;
}
function mailTo(email) { return outbox.filter(m => m.to === email); }

sandbox.setup();
const supervisor = call('login', { email: 'supervisor@example.test', password: tempPasswordFor('supervisor@example.test') });
function staff(email, name, role) {
  call('inviteUser', { name: name, email: email, role_id: role }, supervisor.token);
  return call('login', { email: email, password: tempPasswordFor(email) });
}
const adManager = staff('ads@example.test', 'Ad Manager', 'ADVERTISING_MANAGER');
const seniorEditor = staff('senior@example.test', 'Senior Editor', 'SENIOR_EDITOR');

/* ------------------------------------------------------------ the basics -- */

console.log('\ncustomers and products');

let customer, product;
test('a customer and a product are recorded', () => {
  customer = call('saveCustomer', {
    name: 'Northwind Cells', email: 'accounts@northwind.test',
    billing_address: '4 Cell Road, Bengaluru 560001', tax_id: '29ABCDE1234F1Z5'
  }, adManager.token);
  product = call('saveProduct', {
    sku: 'ART-MID-MONTH', name: 'Article mid-slot, one month',
    unit_price: 4000000, tax_rate: 1800     // ₹40,000.00 in paise, 18% in basis points
  }, adManager.token);
  assert(customer.id && product.id);
});

test('selling is a MANAGE job, not an editorial one', () => {
  throwsWith('forbidden', () => call('saveCustomer', { name: 'X', email: 'x@y.test' }, seniorEditor.token));
  throwsWith('forbidden', () => call('createOrder', { customer_id: customer.id, lines: [] }, seniorEditor.token));
});

/* ------------------------------------------------------------ arithmetic -- */

console.log('\narithmetic');

let order;
test('an order totals from its lines, server-side', () => {
  order = call('createOrder', {
    customer_id: customer.id,
    lines: [{ product_id: product.id, quantity: 3 }],
    total: 1                                   // a client-supplied total must be ignored
  }, adManager.token);
  assert(order.subtotal === 12000000, 'subtotal: ' + order.subtotal);
  assert(order.tax === 2160000, 'tax: ' + order.tax);
  assert(order.total === 14160000, 'total: ' + order.total);
});

test('money is held in whole minor units, so nothing drifts', () => {
  const odd = call('saveProduct', { sku: 'ODD', name: 'Awkward price', unit_price: 33333, tax_rate: 1800 }, adManager.token);
  const o = call('createOrder', {
    customer_id: customer.id, lines: [{ product_id: odd.id, quantity: 3 }]
  }, adManager.token);
  // 3 × 333.33 = 999.99, tax 179.9982 → 179.99 after rounding at the line.
  assert(o.subtotal === 99999, 'subtotal drifted: ' + o.subtotal);
  assert(Number.isInteger(o.tax) && o.tax === 18000, 'tax: ' + o.tax);
  assert(Number.isInteger(o.total), 'the total is not a whole number of paise');
});

test('a discount reduces the taxable amount, not just the total', () => {
  const o = call('createOrder', {
    customer_id: customer.id,
    lines: [{ product_id: product.id, quantity: 1, discount: 1000000 }]
  }, adManager.token);
  assert(o.subtotal === 3000000, 'subtotal: ' + o.subtotal);
  assert(o.tax === 540000, 'tax should be charged on the discounted amount: ' + o.tax);
});

test('a negotiated price is allowed and recorded as an override', () => {
  const o = call('createOrder', {
    customer_id: customer.id,
    lines: [{ product_id: product.id, quantity: 1, unit_price: 3500000 }]
  }, adManager.token);
  assert(o.subtotal === 3500000);
  const row = Db.findOne('Orders', { id: o.id });
  assert(JSON.parse(row.lines)[0].price_overridden === true, 'the override was not recorded');
  assert(Db.all('AuditLogs').some(l => l.action === 'ORDER_CREATED' && /overrides/.test(l.meta)),
    'the audit entry does not mention the override');
});

test('an empty order and a made-up product are both refused', () => {
  throwsWith('empty_order', () => call('createOrder', { customer_id: customer.id, lines: [] }, adManager.token));
  throwsWith('unknown_product', () => call('createOrder', {
    customer_id: customer.id, lines: [{ product_id: 'PRD-NOPE' }]
  }, adManager.token));
});

/* -------------------------------------------------------------- invoices -- */

console.log('\ninvoices');

let invoice;
test('issuing produces a sequential number and emails the customer', () => {
  invoice = call('issueInvoice', { order_id: order.id }, adManager.token);
  assert(/^INV-\d{4}-\d{2}-0001$/.test(invoice.number), 'unexpected number ' + invoice.number);
  assert(invoice.total === 14160000);
  const mail = mailTo('accounts@northwind.test')[0];
  assert(mail, 'the customer was not sent the invoice');
  assert(String(mail.subject).indexOf(invoice.number) !== -1, 'the number is not in the subject');
});

test('numbers are gap-free and never reused', () => {
  const seen = {};
  for (let i = 0; i < 5; i++) {
    const o = call('createOrder', { customer_id: customer.id, lines: [{ product_id: product.id }] }, adManager.token);
    const inv = call('issueInvoice', { order_id: o.id }, adManager.token);
    assert(!seen[inv.number], 'invoice number ' + inv.number + ' was issued twice');
    seen[inv.number] = true;
  }
  const numbers = Object.keys(seen).map(n => Number(n.slice(-4))).sort((a, b) => a - b);
  assert(numbers[0] === 2 && numbers[numbers.length - 1] === 6, 'the sequence has a gap: ' + numbers.join(','));
});

test('an order cannot be invoiced twice', () => {
  throwsWith('already_invoiced', () => call('issueInvoice', { order_id: order.id }, adManager.token));
});

test('the invoice is a snapshot: later price changes do not rewrite it', () => {
  call('saveProduct', { id: product.id, sku: 'ART-MID-MONTH', name: 'Article mid-slot, one month',
                        unit_price: 9900000, tax_rate: 1800 }, adManager.token);
  const row = Db.findOne('Invoices', { id: invoice.id });
  assert(Number(row.total) === 14160000, 'the issued invoice moved with the price list');
  assert(JSON.parse(row.lines)[0].unit_price === 4000000, 'the line price was rewritten');
});

test('the invoice carries the customer details as they were, and the tax note', () => {
  const row = Db.findOne('Invoices', { id: invoice.id });
  const billed = JSON.parse(row.notes);
  assert(billed.tax_id === '29ABCDE1234F1Z5' && billed.address, 'billing details were not captured');
  assert(row.tax_note, 'no tax note on the invoice');
});

test('an issued invoice has no edit path at all', () => {
  // There is no updateInvoice action. Corrections are credit notes, which is
  // the same immutability rule the rest of the platform runs on.
  throwsWith('unknown_action', () => call('updateInvoice', { invoice_id: invoice.id, total: 1 }, supervisor.token));
});

test('the invoice PDF stays out of the public repository', () => {
  const row = Db.findOne('Invoices', { id: invoice.id });
  assert(row.pdf_ref && sandbox.files.has(row.pdf_ref), 'no PDF was generated');
  Object.keys(Object.fromEntries(repo)).forEach(path => {
    assert(path.indexOf('invoice') === -1 && path.indexOf('INV-') === -1,
      'an invoice reached the public site: ' + path);
  });
  const pdf = sandbox.files.get(row.pdf_ref).content;
  assert(pdf.indexOf('Northwind Cells') !== -1, 'the PDF does not name the customer');
});

/* -------------------------------------------------------------- payments -- */

console.log('\npayments');

test('a payment larger than the balance is refused', () => {
  throwsWith('overpayment', () => call('recordPayment', {
    invoice_id: invoice.id, amount: 20000000, method: 'TRANSFER'
  }, adManager.token));
});

test('a partial payment leaves the invoice part paid', () => {
  const res = call('recordPayment', {
    invoice_id: invoice.id, amount: 4000000, method: 'TRANSFER', reference: 'UTR-1'
  }, adManager.token);
  assert(res.outstanding === 10160000, 'outstanding: ' + res.outstanding);
  assert(Db.findOne('Invoices', { id: invoice.id }).status === 'PART_PAID');
});

test('whoever recorded a payment cannot confirm it', () => {
  const pay = Db.all('Payments')[0];
  call('grantPermission', {
    user_id: adManager.user.id, permission: 'APPROVE', scope: '*',
    expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Testing separation of duties'
  }, supervisor.token);
  throwsWith('conflict_of_interest', () => call('verifyPayment', { payment_id: pay.id }, adManager.token));
  assert(Db.all('AuditLogs').some(l => l.action === 'PAYMENT_SELF_VERIFY_BLOCKED'));
  call('verifyPayment', { payment_id: pay.id }, supervisor.token);
  assert(Db.findOne('Payments', { id: pay.id }).verified_by === supervisor.user.id);
});

test('paying the rest settles it exactly', () => {
  const res = call('recordPayment', { invoice_id: invoice.id, amount: 10160000, method: 'UPI' }, adManager.token);
  assert(res.outstanding === 0);
  assert(Db.findOne('Invoices', { id: invoice.id }).status === 'PAID');
  throwsWith('overpayment', () => call('recordPayment', { invoice_id: invoice.id, amount: 1 }, adManager.token));
});

test('zero and nonsense amounts are refused', () => {
  const o = call('createOrder', { customer_id: customer.id, lines: [{ product_id: product.id }] }, adManager.token);
  const inv = call('issueInvoice', { order_id: o.id }, adManager.token);
  throwsWith('bad_amount', () => call('recordPayment', { invoice_id: inv.id, amount: 0 }, adManager.token));
  throwsWith('bad_amount', () => call('recordPayment', { invoice_id: inv.id, amount: 'lots' }, adManager.token));
  throwsWith('bad_amount', () => call('recordPayment', { invoice_id: inv.id, amount: -500 }, adManager.token));
});

/* --------------------------------------------------- voids and corrections -- */

console.log('\nvoids and credit notes');

test('an invoice with money against it cannot be voided', () => {
  throwsWith('has_payments', () => call('voidInvoice', {
    invoice_id: invoice.id, reason: 'Raised against the wrong customer entirely.'
  }, supervisor.token));
});

test('voiding needs a reason and APPROVE, and frees the order', () => {
  const o = call('createOrder', { customer_id: customer.id, lines: [{ product_id: product.id }] }, adManager.token);
  const inv = call('issueInvoice', { order_id: o.id }, adManager.token);
  throwsWith('reason_required', () => call('voidInvoice', { invoice_id: inv.id, reason: 'oops' }, supervisor.token));
  call('voidInvoice', { invoice_id: inv.id, reason: 'Issued against the wrong purchase order.' }, supervisor.token);
  assert(Db.findOne('Invoices', { id: inv.id }).status === 'VOID');
  assert(Db.findOne('Orders', { id: o.id }).status === 'CONFIRMED', 'the order is still marked invoiced');
  // A void number is spent, not recycled.
  const next = call('issueInvoice', { order_id: o.id }, adManager.token);
  assert(next.number !== inv.number, 'a void invoice number was reused');
});

test('a credit note carries negative amounts and credits tax in proportion', () => {
  const res = call('creditNote', {
    invoice_id: invoice.id, amount: 1416000,
    reason: 'One week of the placement did not run because of our outage.'
  }, supervisor.token);
  const note = Db.findOne('Invoices', { id: res.id });
  assert(/^CRN-/.test(note.number), 'a credit note should not look like an invoice: ' + note.number);
  assert(Number(note.total) === -1416000, 'total: ' + note.total);
  assert(Number(note.tax) === -216000, 'tax was not credited in proportion: ' + note.tax);
  assert(note.credit_of === invoice.id);
});

test('a credit note cannot exceed what is left on the invoice', () => {
  throwsWith('too_large', () => call('creditNote', {
    invoice_id: invoice.id, amount: 99000000, reason: 'Trying to credit more than was ever charged.'
  }, supervisor.token));
});

test('a credit note cannot itself be credited', () => {
  const note = Db.all('Invoices').filter(i => i.credit_of === invoice.id)[0];
  throwsWith('bad_status', () => call('creditNote', {
    invoice_id: note.id, reason: 'Crediting the credit, which makes no sense.'
  }, supervisor.token));
});

/* ------------------------------------------------------- the credit gate -- */

console.log('\nthe credit gate on advertising');

test('with the setting off, billing has no opinion about what runs', () => {
  const gate = sandbox.internals.Billing.campaignClear('CMP-ANYTHING');
  assert(gate.clear === true, 'the default should not gate anything');
});

test('with it on, an uninvoiced campaign is not clear to run', () => {
  // setup() seeds this key, so it is updated rather than inserted — a second
  // row with the same key would be shadowed by the first, which is a trap worth
  // knowing about when writing directly to the Settings sheet.
  Db.update('Settings', { key: 'billing.require_payment_before_live' }, { value: 'true' });
  const gate = sandbox.internals.Billing.campaignClear('CMP-NO-ORDER');
  assert(gate.clear === false && /no order/.test(gate.reason), JSON.stringify(gate));
  Db.update('Settings', { key: 'billing.require_payment_before_live' }, { value: 'false' });
});

/* -------------------------------------------------------------- standing -- */

console.log('\nstanding invariants');

test('billing never touches the public site or the publication controls', () => {
  throwsWith('forbidden', () => call('publishConfiguration', {}, adManager.token));
  throwsWith('forbidden', () => call('publishArticle', { article_id: 'MAG-2026-000001' }, adManager.token));
  assert(!Object.keys(Object.fromEntries(repo)).some(p => /billing|customer|payment/i.test(p)),
    'something commercial was committed to the public repository');
});

test('every commercial act is on the record', () => {
  ['CUSTOMER_ADDED', 'PRODUCT_ADDED', 'PRODUCT_UPDATED', 'ORDER_CREATED', 'INVOICE_ISSUED', 'INVOICE_VOIDED',
   'CREDIT_NOTE_ISSUED', 'PAYMENT_RECORDED', 'PAYMENT_VERIFIED']
    .forEach(a => assert(Db.all('AuditLogs').some(l => l.action === a), a + ' was not audited'));
});

test('the supervisor invariants hold at the end as they did at the start', () => {
  throwsWith('forbidden', () => call('setUserRole',
    { user_id: adManager.user.id, role_id: 'SUPERVISOR_ADMIN' }, supervisor.token));
  throwsWith('forbidden', () => call('grantPermission', {
    user_id: adManager.user.id, permission: 'FINAL_PUBLISH',
    expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'covering the launch'
  }, supervisor.token));
});



/* --------------------------------------------------------------- backups -- */
/* Specified in §45 and, until now, in no phase at all. A platform that can
 * publish, invoice and email but cannot be restored is one bad afternoon from
 * being gone. */

console.log('\nbackup and restore');

let snapshot;
test('a backup captures every table', () => {
  snapshot = call('createBackup', { kind: 'MANUAL' }, supervisor.token);
  assert(snapshot.bytes > 0);
  assert(Object.keys(snapshot.counts).length === Object.keys(sandbox.internals.SCHEMA).length,
    'not every table was captured');
  assert(snapshot.counts.Users > 0 && snapshot.counts.Invoices > 0);
});

test('verification reads the file back rather than trusting the record', () => {
  const res = call('verifyBackup', { id: snapshot.id }, supervisor.token);
  assert(res.ok, JSON.stringify(res.problems));
  assert(Db.findOne('Backups', { id: snapshot.id }).verified_at, 'verification was not recorded');
});

test('a snapshot with no supervisor admin fails verification', () => {
  const rec = Db.findOne('Backups', { id: snapshot.id });
  const original = sandbox.files.get(rec.location).content;
  const broken = JSON.parse(original);
  broken.tables.Users = broken.tables.Users.filter(u => u.role_id !== 'SUPERVISOR_ADMIN');
  sandbox.files.get(rec.location).content = JSON.stringify(broken);
  const res = call('verifyBackup', { id: snapshot.id }, supervisor.token);
  assert(!res.ok && res.problems.join(' ').indexOf('lock everyone out') !== -1, JSON.stringify(res.problems));
  sandbox.files.get(rec.location).content = original;
  call('verifyBackup', { id: snapshot.id }, supervisor.token);
});

test('restoring needs the supervisor, a verified snapshot, a phrase and a reason', () => {
  throwsWith('forbidden', () => call('restoreBackup', { id: snapshot.id, confirm: 'RESTORE', reason: 'testing the guard' }, adManager.token));
  throwsWith('confirmation_required', () => call('restoreBackup', { id: snapshot.id, reason: 'testing the guard' }, supervisor.token));
  throwsWith('reason_required', () => call('restoreBackup', { id: snapshot.id, confirm: 'RESTORE' }, supervisor.token));
  const fresh = call('createBackup', {}, supervisor.token);
  throwsWith('verify_first', () => call('restoreBackup',
    { id: fresh.id, confirm: 'RESTORE', reason: 'an unverified snapshot should be refused' }, supervisor.token));
});

test('a restore brings back what was deleted, and snapshots the state it replaced', () => {
  const before = Db.all('Customers').length;
  Db.update('Customers', { id: customer.id }, { name: 'WRONGLY RENAMED', email: 'gone@example.test' });
  const res = call('restoreBackup', {
    id: snapshot.id, confirm: 'RESTORE',
    reason: 'Someone renamed the customer record by accident.'
  }, supervisor.token);
  assert(Db.findOne('Customers', { id: customer.id }).name === 'Northwind Cells', 'the restore did not take');
  assert(Db.all('Customers').length === before, 'the restore duplicated rows');
  assert(res.safety_backup, 'the replaced state was not snapshotted first');
  assert(Db.all('AuditLogs').some(l => l.action === 'DATABASE_RESTORED'), 'the restore was not audited');
});

test('invoices and their numbering survive a restore intact', () => {
  const inv = Db.findOne('Invoices', { id: invoice.id });
  assert(inv && inv.number && Number(inv.total) === 14160000, 'invoice data did not survive');
  const o = call('createOrder', { customer_id: customer.id, lines: [{ product_id: product.id }] }, adManager.token);
  const next = call('issueInvoice', { order_id: o.id }, adManager.token);
  assert(!Db.all('Invoices').filter(i => i.number === next.number)[1],
    'the sequence handed out a number that already existed after a restore');
});

done();
