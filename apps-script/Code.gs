/** Code.gs — the web app entry point and action router.
 *
 *  Contract: POST a JSON body as text/plain (Apps Script cannot answer a CORS
 *  preflight, and text/plain does not trigger one):
 *      { action: string, token: string|null, payload: object }
 *  Response is always JSON:
 *      { ok: true, data: ... }  |  { ok: false, error: code, detail: string }
 *
 *  Two tables decide access. PUBLIC_ACTIONS need no session. Everything else
 *  resolves a session first, and each handler re-checks permissions itself.
 */

const PUBLIC_ACTIONS = {
  // Readers' browsers report ad impressions and clicks here. Unauthenticated by
  // necessity, so Ads.record validates every field, ignores anything it does not
  // recognise, and can only ever increment a counter on an already approved
  // creative. It returns a count and nothing else — no session, no data.
  recordAdEvents: (s, p) => Ads.record(p && p.events),

  // Core Web Vitals from real visits. Same shape as the ad beacon and the same
  // rules: validate everything, count, return nothing else.
  recordVitals: (s, p) => Performance.record(p && p.events),

  // One beacon per visit carrying both advertising and page speed. Two calls
  // meant two Apps Script executions for every reader; this is one, and it
  // writes to a cache rather than a spreadsheet.
  recordTelemetry: (s, p) => Telemetry.record(p),

  // Subscription, confirmation and — above all — unsubscribe. Unsubscribing
  // must work from a link in an old email with no account and no session, so it
  // lives here by necessity and is written to be safe there.
  subscribe: (s, p) => Newsletter.subscribe(p),
  confirmSubscription: (s, p) => Newsletter.confirm(p),
  unsubscribe: (s, p) => Newsletter.unsubscribe(p),

  health: () => ({ env: CFG.env(), time: new Date().toISOString() }),
  login: (s, p, meta) => Auth.login(p.email, p.password, p.mfa_code, meta),

  // The acceptance page is unauthenticated by necessity: the invitee has no
  // account yet. Possession of the emailed token is the credential, and both
  // actions re-validate it, check expiry, and throttle guessing.
  getInvitation: (s, p) => Invitations.lookup(p.id, p.token),
  acceptInvitation: (s, p) => Invitations.accept(p.id, p.token, p)
};

const ACTIONS = {
  /** Several actions, one execution.
   *
   *  A screen in the studio typically needs two or three things at once — the
   *  article and its reviewers, the templates and the identities and the log.
   *  Sent separately that is three Apps Script executions, three cold starts
   *  and three passes over the same tables. Sent together it is one of each:
   *  Db caches every table it reads for the life of a request, so the second
   *  and third actions read from memory rather than from the spreadsheet.
   *
   *  Each call is authorised on its own — batching changes how requests
   *  travel, never what the person is allowed to do — and each fails on its
   *  own, so one refusal does not discard the answers beside it.
   */
  batch: (s, p, meta) => {
    const calls = (p && p.calls) || [];
    if (!Array.isArray(calls) || !calls.length) throw new ApiFail('empty_batch');
    if (calls.length > 12) throw new ApiFail('batch_too_large', 'twelve at a time');

    return {
      results: calls.map(call => {
        const action = String((call && call.action) || '');

        // Public actions are refused here. Signing in through a batch would let
        // a dozen password attempts share one execution, and the rate limit
        // counts executions.
        if (PUBLIC_ACTIONS[action]) return { ok: false, error: 'not_batchable', detail: action };
        if (action === 'batch') return { ok: false, error: 'not_batchable', detail: 'no nesting' };
        if (!ACTIONS[action]) return { ok: false, error: 'unknown_action', detail: action };

        try {
          return { ok: true, data: ACTIONS[action](s, call.payload || {}, meta) };
        } catch (err) {
          if (err instanceof ApiFail) return { ok: false, error: err.code, detail: err.detail };
          console.error(err.stack || err.message);
          return { ok: false, error: 'server_error' };
        }
      })
    };
  },

  me: (s) => ({ user: Auth.publicUser(s.user), permissions: Perms.effective(s.user) }),
  logout: (s) => { Auth.logout(s); return { ok: true }; },
  logoutEverywhere: (s) => { Auth.logoutEverywhere(s); return { ok: true }; },
  changePassword: (s, p) => Auth.changePassword(s, p.current, p.next),

  /* ---- two-factor, enrolled by the person who will use it ---- */

  mfaState: (s) => Auth.mfaState(s),
  beginMfa: (s) => Auth.beginMfa(s),
  enableMfa: (s, p) => Auth.enableMfa(s, p.code),
  disableMfa: (s, p) => Auth.disableMfa(s, p.code),

  listUsers: (s) => Users.list(s),
  inviteUser: (s, p) => Users.invite(s, p),
  setUserRole: (s, p) => Users.setRole(s, p),
  suspendUser: (s, p) => Users.suspend(s, p),
  reactivateUser: (s, p) => Users.reactivate(s, p),
  grantPermission: (s, p) => Users.grant(s, p),

  listRoles: (s) => Roles.list(s),
  createRole: (s, p) => Roles.create(s, p),
  setRolePermissions: (s, p) => Roles.setPermissions(s, p),

  getSettings: (s) => { Perms.require(s, 'VIEW'); return Content.settings(); },
  getMenus: (s) => { Perms.require(s, 'VIEW'); return Content.menus(); },
  getHomepage: (s) => { Perms.require(s, 'VIEW'); return Content.homepage(); },
  getCategories: (s) => { Perms.require(s, 'VIEW'); return Content.categories(); },
  getFeatures: (s) => { Perms.require(s, 'VIEW'); return Content.features(); },

  auditLog: (s, p) => {
    Perms.require(s, 'MANAGE');
    const n = Math.min(Number(p.limit || 100), 500);
    return Db.all('AuditLogs').sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, n);
  },

  publishConfiguration: (s, p) => Publish.configuration(s, p),

  /* ---- phase 2: invitations, authoring, media ---- */

  listInvitations: (s, p) => Invitations.list(s, p),
  createInvitation: (s, p) => Invitations.create(s, p),
  resendInvitation: (s, p) => Invitations.resend(s, p),
  revokeInvitation: (s, p) => Invitations.revoke(s, p),
  extendInvitation: (s, p) => Invitations.extend(s, p),

  editorialBundle: (s) => Formats.bundle(s),

  myArticles: (s) => Articles.mine(s),
  getArticle: (s, p) => Articles.get(s, p),
  createDraft: (s, p) => Articles.create(s, p),
  saveDraft: (s, p) => Articles.save(s, p),
  syncDraft: (s, p) => Articles.sync(s, p),
  submitArticle: (s, p) => Articles.submit(s, p),
  withdrawArticle: (s, p) => Articles.withdraw(s, p),
  startRevision: (s, p) => Articles.startRevision(s, p),

  uploadMedia: (s, p) => Media.upload(s, p),
  removeMedia: (s, p) => Media.remove(s, p),

  myProfile: (s) => Authors.me(s),
  saveProfile: (s, p) => Authors.save(s, p),
  listAuthors: (s) => Authors.list(s),

  notifications: (s, p) => Notifications.list(s, p),
  markNotificationRead: (s, p) => Notifications.markRead(s, p),
  markAllNotificationsRead: (s) => Notifications.markAllRead(s),

  /* ---- phase 3: review, approval, publication ---- */

  editorialQueue: (s, p) => Editorial.queue(s, p),
  openArticle: (s, p) => Editorial.open(s, p),
  moveArticle: (s, p) => Editorial.move(s, p),

  reviewCandidates: (s, p) => Reviews.candidates(s, p),
  assignReviewer: (s, p) => Reviews.assign(s, p),
  cancelReview: (s, p) => Reviews.cancel(s, p),
  myReviews: (s) => Reviews.mine(s),
  openReview: (s, p) => Reviews.read(s, p),
  submitReview: (s, p) => Reviews.submit(s, p),
  articleReviews: (s, p) => Reviews.forArticle(s, p),

  publishArticle: (s, p) => Publish.article(s, p),
  schedulePublication: (s, p) => Publish.schedule(s, p),
  rollbackArticle: (s, p) => Publish.rollback(s, p),
  archiveArticle: (s, p) => Publish.archive(s, p),

  /* ---- phase 4: the guidelines centre ---- */

  guidelineKinds: (s) => { Perms.require(s, 'VIEW'); return Guidelines.kinds(); },
  listGuidelines: (s) => Guidelines.list(s),
  getGuideline: (s, p) => Guidelines.get(s, p),
  draftGuideline: (s, p) => Guidelines.createDraft(s, p),
  saveGuideline: (s, p) => Guidelines.save(s, p),
  moveGuideline: (s, p) => Guidelines.move(s, p),
  publishGuideline: (s, p) => Guidelines.publish(s, p),
  restoreGuideline: (s, p) => Guidelines.restore(s, p),

  rulebook: (s) => Formats.all(s),
  saveFormat: (s, p) => Formats.saveFormat(s, p),
  saveFormatField: (s, p) => Formats.saveField(s, p),
  saveChecklistItem: (s, p) => Formats.saveChecklistItem(s, p),
  saveEditorialRules: (s, p) => Formats.saveRules(s, p),

  /* ---- phase 5: the control centre ---- */

  siteConfiguration: (s) => SiteConfig.all(s),
  saveMenuItem: (s, p) => SiteConfig.saveMenu(s, p),
  saveHomepageSection: (s, p) => SiteConfig.saveSection(s, p),
  saveCategory: (s, p) => SiteConfig.saveCategory(s, p),
  setFeatureFlag: (s, p) => SiteConfig.setFlag(s, p),
  saveSiteSettings: (s, p) => SiteConfig.saveSettings(s, p),
  previewConfiguration: (s) => SiteConfig.preview(s),
  configurationVersions: (s) => SiteConfig.versions(s),
  rollbackConfiguration: (s, p) => SiteConfig.rollback(s, p),
  adoptConfiguration: (s, p) => SiteConfig.adopt(s, p),

  listGrants: (s) => Users.listGrants(s),
  revokeGrant: (s, p) => Users.revokeGrant(s, p),
  emergencyAccess: (s, p) => Users.emergencyAccess(s, p),

  /* ---- phase 6: advertising ---- */

  adsBundle: (s) => Ads.bundle(s),
  saveAdvertiser: (s, p) => Ads.saveAdvertiser(s, p),
  saveCampaign: (s, p) => Ads.saveCampaign(s, p),
  uploadCreative: (s, p) => Ads.uploadCreative(s, p),
  reviewCreative: (s, p) => Ads.reviewCreative(s, p),
  pauseCreative: (s, p) => Ads.pauseCreative(s, p),
  saveAdPlacement: (s, p) => Ads.savePlacement(s, p),
  adDelivery: (s, p) => Ads.delivery(s, p),
  publishAds: (s) => Publish.ads(s),

  /* ---- phase 7: email, newsletter, social ---- */

  newsletterOverview: (s) => Newsletter.overview(s),
  exportSubscribers: (s) => Newsletter.exportAudience(s),
  listEmailCampaigns: (s) => Newsletter.campaigns(s),
  getEmailCampaign: (s, p) => Newsletter.get(s, p),
  draftEmailCampaign: (s, p) => Newsletter.draft(s, p),
  saveEmailCampaign: (s, p) => Newsletter.save(s, p),
  testEmailCampaign: (s, p) => Newsletter.test(s, p),
  approveEmailCampaign: (s, p) => Newsletter.approve(s, p),
  startEmailCampaign: (s, p) => Newsletter.start(s, p),
  stopEmailCampaign: (s, p) => Newsletter.stop(s, p),

  socialQueue: (s, p) => Social.queue(s, p),
  socialCompose: (s, p) => Social.compose(s, p),
  socialMarkPosted: (s, p) => Social.markPosted(s, p),
  socialDiscard: (s, p) => Social.discard(s, p),

  /* ---- phase 8: magazine issues ---- */

  listIssues: (s) => Issues.list(s),
  getIssue: (s, p) => Issues.get(s, p),
  createIssue: (s, p) => Issues.create(s, p),
  saveIssue: (s, p) => Issues.save(s, p),
  uploadIssueCover: (s, p) => Issues.uploadCover(s, p),
  moveIssue: (s, p) => Issues.move(s, p),
  buildIssuePdf: (s, p) => Issues.buildPdf(s, p),
  publishIssue: (s, p) => Publish.issue(s, p),

  /* ---- the email centre ---- */

  emailTemplates: (s) => EmailCentre.list(s),
  getEmailTemplate: (s, p) => EmailCentre.get(s, p),
  saveEmailTemplate: (s, p) => EmailCentre.save(s, p),
  resetEmailTemplate: (s, p) => EmailCentre.reset(s, p),
  previewEmailTemplate: (s, p) => EmailCentre.preview(s, p),
  sendTestEmail: (s, p) => EmailCentre.sendTest(s, p),
  emailIdentities: (s) => { Perms.require(s, 'MANAGE'); return Email.identities(); },
  saveEmailIdentities: (s, p) => EmailCentre.saveIdentities(s, p),
  emailLog: (s, p) => EmailCentre.log(s, p),

  /* ---- what is live, and correcting it ---- */

  liveArticles: (s, p) => Publish.liveIndex(s, p),
  correctLiveArticle: (s, p) => Publish.updateLive(s, p),

  /* ---- phase 9: performance ---- */

  /** Everything the studio's opening screen needs, in one execution.
   *  Five separate calls meant five executions and five passes over the same
   *  tables every time somebody opened the tool. */
  studioDashboard: (s) => {
    Perms.require(s, 'VIEW');
    const out = { queue: null, reviews: null, pending: null, ads: null, newsletter: null, backups: null };
    const attempt = (key, fn) => { try { out[key] = fn(); } catch (e) { out[key] = null; } };
    attempt('queue', () => Editorial.queue(s, {}).map(a => ({ id: a.id, version_status: a.version_status })));
    attempt('reviews', () => Reviews.mine(s).length);
    attempt('pending', () => SiteConfig.pending(s).count);
    attempt('ads', () => Db.all('AdCreatives').filter(c => c.status === 'PENDING').length);
    attempt('newsletter', () => {
      const subs = Db.all('Subscribers');
      return { confirmed: subs.filter(x => x.status === 'CONFIRMED').length,
               pending: subs.filter(x => x.status === 'PENDING').length };
    });
    attempt('backups', () => {
      const last = Db.all('Backups').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      return last ? { created_at: last.created_at, verified_at: last.verified_at || '' } : null;
    });
    return out;
  },

  performanceReport: (s, p) => Performance.report(s, p),
  payloadBudget: (s) => Performance.budget(s),

  /* ---- phase 10: billing ---- */

  billing: (s) => Billing.bundle(s),
  saveCustomer: (s, p) => Billing.saveCustomer(s, p),
  saveProduct: (s, p) => Billing.saveProduct(s, p),
  createOrder: (s, p) => Billing.createOrder(s, p),
  issueInvoice: (s, p) => Billing.issueInvoice(s, p),
  voidInvoice: (s, p) => Billing.voidInvoice(s, p),
  creditNote: (s, p) => Billing.creditNote(s, p),
  recordPayment: (s, p) => Billing.recordPayment(s, p),
  verifyPayment: (s, p) => Billing.verifyPayment(s, p),

  /* ---- backup and restore ---- */

  listBackups: (s) => Backup.list(s),
  createBackup: (s, p) => Backup.run(s, p),
  verifyBackup: (s, p) => Backup.verify(s, p),
  downloadBackup: (s, p) => Backup.download(s, p),
  restoreBackup: (s, p) => Backup.restore(s, p)
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ ok: false, error: 'empty_request' });
    let req;
    try { req = JSON.parse(e.postData.contents); }
    catch (err) { return json_({ ok: false, error: 'bad_json' }); }

    const action = String(req.action || '');
    // Image uploads get a larger ceiling than ordinary calls; everything else
    // stays small so a single request cannot tie up the script.
    const ceiling = action === 'uploadMedia' ? LIMITS.MAX_MEDIA_BYTES : LIMITS.MAX_PAYLOAD_BYTES;
    if (e.postData.contents.length > ceiling) return json_({ ok: false, error: 'payload_too_large' });

    const payload = req.payload || {};
    const meta = { ua: (e.parameter && e.parameter.ua) || '', ip: '' };

    if (PUBLIC_ACTIONS[action]) {
      return json_({ ok: true, data: PUBLIC_ACTIONS[action](null, payload, meta) });
    }
    if (!ACTIONS[action]) return json_({ ok: false, error: 'unknown_action' });

    const session = Auth.session(req.token);
    if (!session) return json_({ ok: false, error: 'unauthenticated' });

    return json_({ ok: true, data: ACTIONS[action](session, payload, meta) });

  } catch (err) {
    if (err instanceof ApiFail) return json_({ ok: false, error: err.code, detail: err.detail });
    console.error(err.stack || err.message);
    return json_({ ok: false, error: 'server_error' });   // no internals leak outward
  } finally {
    Db.flush();
  }
}

/** GET exists only for a health check. Public content is never served from
 *  here — it is served as static files from the site repository. */
function doGet() {
  return json_({ ok: true, data: { service: 'magazine-api', env: CFG.env() } });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
