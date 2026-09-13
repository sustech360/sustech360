/** Social.gs — the social queue.
 *
 *  This platform has no social media credentials and does not ask for any. What
 *  it does is write the post, hold it in a queue, and record when a human sent
 *  it. That is deliberate: an automated poster needs long-lived write tokens for
 *  every account, and the failure mode of a compromised one is the magazine's
 *  name saying something it did not say.
 *
 *  When API posting is wired up later, `markPosted` is the seam: it becomes the
 *  callback rather than a button, and everything else stays.
 */

const SOCIAL_PLATFORMS = {
  linkedin: { name: 'LinkedIn', limit: 1200, tags: 3 },
  x:        { name: 'X',        limit: 260,  tags: 2 },
  facebook: { name: 'Facebook', limit: 600,  tags: 2 },
  telegram: { name: 'Telegram', limit: 900,  tags: 0 }
};

const Social = {

  queue: function (session, p) {
    Perms.require(session, 'VIEW');
    const want = (p && p.status) ? [String(p.status)] : ['QUEUED', 'POSTED', 'DISCARDED'];
    return Db.all('SocialPosts')
      .filter(x => want.indexOf(x.status) !== -1)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 100)
      .map(x => ({
        id: x.id, article_id: x.article_id, platform: x.platform,
        platform_name: (SOCIAL_PLATFORMS[x.platform] || {}).name || x.platform,
        text: x.text, link: x.link, status: x.status, created_at: x.created_at,
        posted_at: x.posted_at || '', note: x.note || ''
      }));
  },

  /** Writes a post for each platform asked for. Only for something already
   *  published: a social post is a publication, and this is not a second route
   *  to one. */
  compose: function (session, p) {
    Perms.require(session, 'MANAGE');
    const a = Db.findOne('Articles', { id: String(p.article_id || '') });
    if (!a) throw new ApiFail('not_found');
    if (a.status !== 'PUBLISHED' || !Number(a.public_version || 0)) {
      Audit.log(session, 'SOCIAL_UNPUBLISHED_BLOCKED', 'article', a.id, { meta: { status: a.status } });
      throw new ApiFail('not_published', 'only a published article can be posted about');
    }
    const platforms = (p.platforms || Object.keys(SOCIAL_PLATFORMS))
      .filter(x => SOCIAL_PLATFORMS[String(x)]);
    if (!platforms.length) throw new ApiFail('no_platform');

    const made = platforms.map(platform => this.write_(session, a, platform, p.angle));
    Audit.log(session, 'SOCIAL_COMPOSED', 'article', a.id, { meta: { platforms: platforms } });
    return { ok: true, posts: made };
  },

  write_: function (session, a, platform, angle) {
    const spec = SOCIAL_PLATFORMS[platform];
    const link = CFG.get('SITE_URL', '') + 'article.html?a=' + a.slug;
    const doc = this.published_(a);
    const summary = String(angle || (doc && doc.summary) || '').trim();
    const tags = asList(a.topics).slice(0, spec.tags)
      .map(t => '#' + String(t).replace(/[^A-Za-z0-9]/g, '')).join(' ');

    // Reserve room for the link and the tags before trimming the sentence, so
    // the text never ends mid-word with the URL cut off.
    const room = spec.limit - link.length - tags.length - 4;
    let text = a.title;
    if (summary && room > a.title.length + 20) {
      text = a.title + '\n\n' + this.trim_(summary, room - a.title.length - 2);
    } else {
      text = this.trim_(a.title, room);
    }
    const body = [text, tags].filter(Boolean).join('\n\n');

    const existing = Db.find('SocialPosts', { article_id: a.id, platform: platform })
      .filter(x => x.status === 'QUEUED')[0];
    if (existing) {
      Db.update('SocialPosts', { id: existing.id }, { text: body, link: link });
      return { id: existing.id, platform: platform, text: body, link: link, replaced: true };
    }
    const rec = Db.insert('SocialPosts', {
      id: Db.newId('SOC'), article_id: a.id, platform: platform,
      text: body, link: link, status: 'QUEUED', created_at: new Date().toISOString()
    });
    return { id: rec.id, platform: platform, text: body, link: link, replaced: false };
  },

  trim_: function (s, max) {
    s = String(s).replace(/\s+/g, ' ').trim();
    if (max < 20) return s.slice(0, Math.max(0, max));
    if (s.length <= max) return s;
    const cut = s.slice(0, max - 1);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
    return (stop > max * 0.6 ? cut.slice(0, stop) : cut).replace(/[,;:.\s]+$/, '') + '…';
  },

  markPosted: function (session, p) {
    Perms.require(session, 'MANAGE');
    const rec = Db.findOne('SocialPosts', { id: String(p.id || '') });
    if (!rec) throw new ApiFail('not_found');
    if (rec.status !== 'QUEUED') throw new ApiFail('already_done', 'this post is ' + rec.status);
    Db.update('SocialPosts', { id: rec.id }, {
      status: 'POSTED', posted_at: new Date().toISOString(), posted_by: session.user.id,
      note: String(p.url || '').slice(0, 300)
    });
    Audit.log(session, 'SOCIAL_POSTED', 'social', rec.id,
      { next: rec.platform, meta: { article: rec.article_id } });
    return { ok: true };
  },

  discard: function (session, p) {
    Perms.require(session, 'MANAGE');
    const rec = Db.findOne('SocialPosts', { id: String(p.id || '') });
    if (!rec) throw new ApiFail('not_found');
    Db.update('SocialPosts', { id: rec.id }, { status: 'DISCARDED', note: String(p.reason || '').slice(0, 200) });
    Audit.log(session, 'SOCIAL_DISCARDED', 'social', rec.id, { reason: p.reason || '' });
    return { ok: true };
  },

  /** Called by the publishing engine. Queues drafts so the person handling
   *  social starts from something rather than a blank box; it never posts. */
  onPublish_: function (article) {
    try {
      if (((Content.features().flags || {}).SOCIAL || {}).state !== 'enabled') return;
      const system = { user: { id: 'SYSTEM', email: 'system', role_id: SUPERVISOR_ROLE } };
      Object.keys(SOCIAL_PLATFORMS).forEach(platform => this.write_(system, article, platform, ''));
    } catch (e) {
      console.error('social queue failed for ' + article.id + ': ' + e.message);
    }
  },

  published_: function (a) {
    const row = Db.findOne('Settings', { key: 'public.' + a.id });
    if (!row) return null;
    try { return JSON.parse(row.value); } catch (e) { return null; }
  }
};
