/** Ads.gs — the advertising control centre.
 *
 *  Two rules shape this file.
 *
 *  An advertisement appears next to the journalism, so putting one there is an
 *  editorial decision as well as a commercial one. A creative is uploaded by
 *  whoever sells it, approved by someone holding APPROVE, and only then can it
 *  be published — and publication is still the supervisor admin's commit, like
 *  everything else that reaches a reader.
 *
 *  Campaigns run on dates, not on deployments. An approved creative carries its
 *  own window into the published file, so a campaign that starts on Tuesday
 *  starts on Tuesday without anyone touching the system. The hourly trigger at
 *  the bottom republishes when a window opens or closes; it never approves
 *  anything, and it cannot put an unapproved creative on the site.
 */

const AD_TIERS = ['DIRECT', 'PREMIUM', 'STANDARD', 'HOUSE', 'MAGAZINE'];
const AD_LABELS = ['Advertisement', 'Sponsored'];
const AD_CHAIN_STEPS = ['DIRECT', 'PREMIUM', 'STANDARD', 'ADSENSE', 'HOUSE', 'MAGAZINE', 'RELATED', 'COLLAPSE'];

const Ads = {

  /* ---------------- reading ---------------- */

  bundle: function (session) {
    Perms.require(session, 'MANAGE');
    return {
      advertisers: Db.all('Advertisers'),
      campaigns: Db.all('Campaigns').map(c => {
        const adv = Db.findOne('Advertisers', { id: c.advertiser_id });
        return Object.assign({}, c, { advertiser: adv ? adv.company : '' });
      }),
      creatives: Db.all('AdCreatives').map(c => this.shape_(c)),
      placements: Db.all('AdPlacements').map(p => ({
        id: p.id, name: p.name, description: p.description || '',
        chain: asList(p.chain), active: p.active === true || p.active === 'TRUE'
      })),
      tiers: AD_TIERS, labels: AD_LABELS, chain_steps: AD_CHAIN_STEPS,
      live: this.livePlacements_()
    };
  },

  shape_: function (c) {
    const campaign = c.campaign_id ? Db.findOne('Campaigns', { id: c.campaign_id }) : null;
    const advertiser = c.advertiser_id ? Db.findOne('Advertisers', { id: c.advertiser_id }) : null;
    return {
      id: c.id, name: c.name, placement: c.placement, tier: c.tier,
      campaign_id: c.campaign_id || '', campaign: campaign ? campaign.name : '',
      advertiser: advertiser ? advertiser.company : '',
      file: c.file || '', url: c.url || '', alt: c.alt || '', label: c.label || 'Advertisement',
      weight: Number(c.weight || 1), targeting: c.targeting ? JSON.parse(c.targeting) : {},
      starts: c.starts || '', ends: c.ends || '', status: c.status,
      approved_by: c.approved_by || '', approved_at: c.approved_at || '', notes: c.notes || ''
    };
  },

  /* ---------------- advertisers and campaigns ---------------- */

  saveAdvertiser: function (session, p) {
    Perms.require(session, 'MANAGE');
    const company = String(p.company || '').trim();
    if (company.length < 2) throw new ApiFail('bad_company');
    const email = String(p.email || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiFail('bad_email');
    const website = String(p.website || '').trim();
    if (website && !/^https:\/\/[^\s"'<>]+$/.test(website)) throw new ApiFail('bad_url', 'use an https address');

    const patch = {
      company: company.slice(0, 120), contact: String(p.contact || '').slice(0, 120),
      email: email, website: website, country: String(p.country || '').slice(0, 60),
      status: p.status === 'BLOCKED' ? 'BLOCKED' : 'ACTIVE', notes: String(p.notes || '').slice(0, 500)
    };
    if (p.id) {
      const existing = Db.findOne('Advertisers', { id: String(p.id) });
      if (!existing) throw new ApiFail('not_found');
      Db.update('Advertisers', { id: existing.id }, patch);
      Audit.log(session, 'ADVERTISER_UPDATED', 'advertiser', existing.id,
        { prev: existing.status, next: patch.status, meta: { company: company } });
      return { ok: true, id: existing.id };
    }
    const rec = Db.insert('Advertisers', Object.assign({ id: Db.newId('ADV'), created_by: session.user.id }, patch));
    Audit.log(session, 'ADVERTISER_ADDED', 'advertiser', rec.id, { next: company });
    return { ok: true, id: rec.id };
  },

  saveCampaign: function (session, p) {
    Perms.require(session, 'MANAGE');
    const advertiser = Db.findOne('Advertisers', { id: String(p.advertiser_id || '') });
    if (!advertiser) throw new ApiFail('unknown_advertiser');
    if (advertiser.status === 'BLOCKED') throw new ApiFail('advertiser_blocked');
    const tier = AD_TIERS.indexOf(String(p.tier)) !== -1 ? String(p.tier) : 'STANDARD';
    if (!p.starts || !p.ends) throw new ApiFail('dates_required');
    if (new Date(p.starts) >= new Date(p.ends)) throw new ApiFail('bad_schedule', 'the end is not after the start');

    const patch = {
      advertiser_id: advertiser.id, name: String(p.name || '').slice(0, 120) || 'Untitled campaign',
      package: String(p.package || '').slice(0, 80), tier: tier,
      starts: new Date(p.starts).toISOString(), ends: new Date(p.ends).toISOString(),
      notes: String(p.notes || '').slice(0, 500)
    };
    if (p.id) {
      const existing = Db.findOne('Campaigns', { id: String(p.id) });
      if (!existing) throw new ApiFail('not_found');
      Db.update('Campaigns', { id: existing.id }, patch);
      Audit.log(session, 'CAMPAIGN_UPDATED', 'campaign', existing.id, { meta: { name: patch.name } });
      return { ok: true, id: existing.id };
    }
    const rec = Db.insert('Campaigns', Object.assign({
      id: Db.newId('CMP'), status: 'DRAFT', created_by: session.user.id
    }, patch));
    Audit.log(session, 'CAMPAIGN_CREATED', 'campaign', rec.id, { next: patch.name, meta: { tier: tier } });
    return { ok: true, id: rec.id };
  },

  /* ---------------- creatives ---------------- */

  uploadCreative: function (session, p) {
    Perms.require(session, 'MANAGE');
    const placement = Db.findOne('AdPlacements', { id: String(p.placement || '') });
    if (!placement) throw new ApiFail('unknown_placement');
    const campaign = p.campaign_id ? Db.findOne('Campaigns', { id: String(p.campaign_id) }) : null;
    if (p.campaign_id && !campaign) throw new ApiFail('unknown_campaign');

    const tier = AD_TIERS.indexOf(String(p.tier)) !== -1 ? String(p.tier)
               : (campaign ? campaign.tier : 'HOUSE');
    // A paid tier without an advertiser behind it is how unattributed
    // advertising ends up on a publication that promises disclosure.
    if (['DIRECT', 'PREMIUM', 'STANDARD'].indexOf(tier) !== -1 && !campaign) {
      throw new ApiFail('campaign_required', 'a paid creative belongs to a campaign');
    }
    const label = AD_LABELS.indexOf(String(p.label)) !== -1 ? String(p.label) : 'Advertisement';
    const alt = String(p.alt || '').trim();
    if (alt.length < 3) throw new ApiFail('alt_required', 'describe the image for readers using a screen reader');

    const target = String(p.url || '').trim();
    if (!/^https:\/\/[^\s"'<>]+$/.test(target)) {
      throw new ApiFail('bad_url', 'an advertisement links to an https address');
    }

    const rules = Formats.rules().media;
    const mime = String(p.mime || '');
    if (rules.mime.indexOf(mime) === -1) throw new ApiFail('bad_type', 'accepted formats: ' + rules.mime.join(', '));
    const bytes = Utilities.base64Decode(String(p.data || ''));
    if (!bytes.length) throw new ApiFail('empty_file');
    if (bytes.length > rules.max_bytes) throw new ApiFail('too_large');

    const name = String(p.file || 'creative').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
    const file = this.folder_().createFile(Utilities.newBlob(bytes, mime, name));
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    const starts = p.starts || (campaign ? campaign.starts : new Date().toISOString());
    const ends = p.ends || (campaign ? campaign.ends : '');
    if (campaign && (new Date(starts) < new Date(campaign.starts) || new Date(ends) > new Date(campaign.ends))) {
      throw new ApiFail('outside_campaign', 'the creative runs outside its campaign window');
    }

    const rec = Db.insert('AdCreatives', {
      id: Db.newId('CRE'), name: String(p.name || name).slice(0, 120),
      placement: placement.id, tier: tier,
      campaign_id: campaign ? campaign.id : '', advertiser_id: campaign ? campaign.advertiser_id : '',
      drive_id: file.getId(), file: name, url: target, alt: alt.slice(0, 200), label: label,
      weight: Math.max(1, Math.min(10, Number(p.weight || 1))),
      targeting: JSON.stringify(this.targeting_(p.targeting)),
      starts: starts, ends: ends, status: 'PENDING', created_by: session.user.id
    });
    Audit.log(session, 'CREATIVE_UPLOADED', 'creative', rec.id,
      { next: placement.id, meta: { tier: tier, bytes: bytes.length } });
    return { ok: true, id: rec.id, bytes: bytes.length };
  },

  targeting_: function (t) {
    t = t || {};
    const sections = (t.sections || []).filter(s => Db.findOne('Categories', { slug: String(s) }));
    const devices = (t.devices || []).filter(d => ['mobile', 'desktop'].indexOf(String(d)) !== -1);
    return { sections: sections, devices: devices };
  },

  /** Approval is an editorial act: someone holding APPROVE decides whether this
   *  belongs beside the journalism. The seller cannot approve their own upload. */
  reviewCreative: function (session, p) {
    const c = Db.findOne('AdCreatives', { id: String(p.creative_id || '') });
    if (!c) throw new ApiFail('not_found');
    Perms.require(session, 'APPROVE');
    if (c.status !== 'PENDING') throw new ApiFail('already_reviewed', 'this creative is ' + c.status);
    if (String(c.created_by) === String(session.user.id)) {
      Audit.log(session, 'CREATIVE_SELF_APPROVAL_BLOCKED', 'creative', c.id, {});
      throw new ApiFail('conflict_of_interest', 'someone else has to approve what you uploaded');
    }
    const decision = String(p.decision || '');
    if (['APPROVED', 'REJECTED'].indexOf(decision) === -1) throw new ApiFail('bad_decision');

    // Credit control, if the operator wants it. Off by default: whether a paid
    // creative may run before its invoice is settled is a commercial policy,
    // not something a content platform should decide on anyone's behalf.
    if (decision === 'APPROVED' && ['DIRECT', 'PREMIUM', 'STANDARD'].indexOf(c.tier) !== -1) {
      const gate = Billing.campaignClear(c.campaign_id);
      if (!gate.clear) {
        Audit.log(session, 'CREATIVE_BLOCKED_UNPAID', 'creative', c.id, { reason: gate.reason });
        throw new ApiFail('payment_required', gate.reason);
      }
    }
    const reason = String(p.reason || '').trim();
    if (decision === 'REJECTED' && reason.length < 10) throw new ApiFail('reason_required');

    Db.update('AdCreatives', { id: c.id }, {
      status: decision, approved_by: session.user.id,
      approved_at: new Date().toISOString(), notes: reason
    });
    if (c.campaign_id) {
      const live = Db.find('AdCreatives', { campaign_id: c.campaign_id }).some(x => x.status === 'APPROVED');
      Db.update('Campaigns', { id: c.campaign_id }, {
        status: live ? 'APPROVED' : 'DRAFT',
        approved_by: session.user.id, approved_at: new Date().toISOString()
      });
    }
    Audit.log(session, 'CREATIVE_REVIEWED', 'creative', c.id,
      { prev: 'PENDING', next: decision, reason: reason });
    return { ok: true, status: decision };
  },

  /** Pulling a creative is the emergency action, so it is deliberately easy and
   *  always audited. The site stops showing it at the next publish. */
  pauseCreative: function (session, p) {
    Perms.require(session, 'MANAGE');
    const c = Db.findOne('AdCreatives', { id: String(p.creative_id || '') });
    if (!c) throw new ApiFail('not_found');
    const reason = String(p.reason || '').trim();
    if (reason.length < 5) throw new ApiFail('reason_required');
    Db.update('AdCreatives', { id: c.id }, { status: 'PAUSED', notes: reason });
    Audit.log(session, 'CREATIVE_PAUSED', 'creative', c.id, { prev: c.status, next: 'PAUSED', reason: reason });
    return { ok: true };
  },

  /* ---------------- placements ---------------- */

  savePlacement: function (session, p) {
    Perms.require(session, 'MANAGE');
    const id = String(p.id || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (id.length < 3) throw new ApiFail('bad_placement');
    const chain = (p.chain || AD_CHAIN_STEPS).filter(s => AD_CHAIN_STEPS.indexOf(String(s)) !== -1);
    if (!chain.length) throw new ApiFail('bad_chain');
    if (chain[chain.length - 1] !== 'COLLAPSE') chain.push('COLLAPSE');

    const existing = Db.findOne('AdPlacements', { id: id });
    const patch = {
      name: String(p.name || id).slice(0, 60), description: String(p.description || '').slice(0, 200),
      chain: JSON.stringify(chain), active: p.active === true, updated_at: new Date().toISOString()
    };
    if (existing) {
      Db.update('AdPlacements', { id: id }, patch);
      Audit.log(session, 'PLACEMENT_UPDATED', 'placement', id,
        { prev: String(existing.active), next: String(patch.active) });
    } else {
      Db.insert('AdPlacements', Object.assign({ id: id }, patch));
      Audit.log(session, 'PLACEMENT_ADDED', 'placement', id, { next: patch.name });
    }
    return { ok: true, id: id };
  },

  /* ---------------- the published file ---------------- */

  /** Only approved creatives, and only inside their window plus a margin, so a
   *  campaign starting tomorrow is already in the file and starts itself. */
  publicBundle: function () {
    const placements = {};
    Db.all('AdPlacements').forEach(p => {
      placements[p.id] = {
        active: p.active === true || p.active === 'TRUE',
        chain: asList(p.chain)
      };
    });
    const horizon = Date.now() + 30 * 86400000;
    const creatives = [];
    const house = [];
    Db.all('AdCreatives').forEach(c => {
      if (c.status !== 'APPROVED') return;                       // the whole point
      if (c.ends && new Date(c.ends).getTime() < Date.now()) return;
      if (c.starts && new Date(c.starts).getTime() > horizon) return;
      const entry = {
        id: c.id, placement: c.placement, tier: c.tier,
        image: 'assets/ads/' + c.id + '/' + c.file, url: c.url, alt: c.alt,
        label: c.label || 'Advertisement', weight: Number(c.weight || 1),
        targeting: c.targeting ? JSON.parse(c.targeting) : {},
        starts: c.starts || '', ends: c.ends || ''
      };
      if (c.tier === 'HOUSE' || c.tier === 'MAGAZINE') house.push(entry);
      else creatives.push(entry);
    });
    return { version: 1, generated_at: new Date().toISOString(),
             placements: placements, creatives: creatives, house: house };
  },

  /* ---------------- delivery ---------------- */

  /** Counts arrive from readers' browsers in one batch as the page unloads.
   *  Anything unrecognised is dropped silently: this endpoint is unauthenticated
   *  and its only job is to not become an attack surface. */
  record: function (events) {
    if (!Array.isArray(events) || !events.length || events.length > 40) return { ok: true, counted: 0 };
    const day = new Date().toISOString().slice(0, 10);
    let counted = 0;
    events.slice(0, 40).forEach(e => {
      const id = String((e && e.id) || '').slice(0, 40);
      const creative = Db.findOne('AdCreatives', { id: id });
      if (!creative || creative.status !== 'APPROVED') return;
      const impressions = Math.max(0, Math.min(5, Number(e.i || 0)));
      const clicks = Math.max(0, Math.min(5, Number(e.c || 0)));
      if (!impressions && !clicks) return;
      const existing = Db.findOne('AdEvents', { day: day, creative_id: id });
      if (existing) {
        Db.update('AdEvents', { id: existing.id }, {
          impressions: Number(existing.impressions || 0) + impressions,
          clicks: Number(existing.clicks || 0) + clicks,
          updated_at: new Date().toISOString()
        });
      } else {
        Db.insert('AdEvents', {
          id: Db.newId('AEV'), day: day, placement: creative.placement, creative_id: id,
          impressions: impressions, clicks: clicks, updated_at: new Date().toISOString()
        });
      }
      counted++;
    });
    return { ok: true, counted: counted };
  },

  /** Our numbers, not audited numbers. The screen says so, and so does this. */
  delivery: function (session, p) {
    Perms.require(session, 'VIEW');
    const since = p && p.since ? String(p.since) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = Db.all('AdEvents').filter(e => String(e.day) >= since);
    const byCreative = {};
    rows.forEach(e => {
      const k = e.creative_id;
      byCreative[k] = byCreative[k] || { creative_id: k, placement: e.placement, impressions: 0, clicks: 0 };
      byCreative[k].impressions += Number(e.impressions || 0);
      byCreative[k].clicks += Number(e.clicks || 0);
    });
    return {
      since: since,
      caveat: 'Counted in readers\' browsers and reported best effort. Ad blockers and cached pages are not counted.',
      rows: Object.keys(byCreative).map(k => {
        const c = Db.findOne('AdCreatives', { id: k });
        const r = byCreative[k];
        r.name = c ? c.name : k;
        r.tier = c ? c.tier : '';
        r.rate = r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0;
        return r;
      }).sort((a, b) => b.impressions - a.impressions)
    };
  },

  livePlacements_: function () {
    return Db.all('AdPlacements').filter(p => p.active === true || p.active === 'TRUE').map(p => p.id);
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('advertising');
    return it.hasNext() ? it.next() : root.createFolder('advertising');
  }
};

/** Hourly trigger. Republishes the ad file when a window opens or closes, so
 *  campaigns start and stop on their dates without anyone signing in. It emits
 *  exactly what Ads.publicBundle emits — approved creatives only — and so it
 *  cannot put anything on the site that a person did not already approve. */
function refreshAdSchedule() {
  const now = Date.now();
  const hour = 3600000;
  const moved = Db.all('AdCreatives').filter(c => {
    if (c.status !== 'APPROVED') return false;
    const s = c.starts ? new Date(c.starts).getTime() : 0;
    const e = c.ends ? new Date(c.ends).getTime() : 0;
    return (s && now - s >= 0 && now - s < hour) || (e && now - e >= 0 && now - e < hour);
  });
  if (!moved.length) return 'nothing due';
  const system = { user: { id: 'SYSTEM', email: 'system', role_id: SUPERVISOR_ROLE, session_epoch: 1 } };
  Publish.ads(system);
  Audit.log(system, 'AD_SCHEDULE_REFRESHED', 'site', CFG.env(), { meta: { creatives: moved.length } });
  return moved.length + ' creative window(s) changed';
}
