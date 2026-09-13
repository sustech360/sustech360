/** Authors.gs — the researcher profile behind a byline.
 *  Nothing here is public until `public` is true AND the profile has been
 *  approved; the publishing engine reads only approved fields. */
const Authors = {

  me: function (session) {
    Perms.require(session, 'VIEW');
    const a = Db.findOne('Authors', { user_id: session.user.id });
    if (!a) return null;
    return this.shape_(a, session.user);
  },

  save: function (session, p) {
    Perms.require(session, 'VIEW');
    const a = Db.findOne('Authors', { user_id: session.user.id });
    if (!a) throw new ApiFail('no_profile');
    const patch = {
      display_name: String(p.display_name || a.display_name).slice(0, 120),
      institution: String(p.institution || '').slice(0, 200),
      position: String(p.position || '').slice(0, 120),
      country: String(p.country || '').slice(0, 80),
      bio: String(p.bio || '').slice(0, 1500),
      interests: String(p.interests || '').slice(0, 400),
      website: this.safeUrl_(p.website),
      orcid: this.orcid_(p.orcid),
      public: p.public === true
    };
    Db.update('Authors', { id: a.id }, patch);
    if (patch.display_name !== session.user.name) {
      Db.update('Users', { id: session.user.id }, { name: patch.display_name });
    }
    Audit.log(session, 'AUTHOR_PROFILE_UPDATED', 'author', a.id, { meta: { public: patch.public } });
    return { ok: true };
  },

  /** Editors need to see who they are working with. */
  list: function (session) {
    Perms.require(session, 'VIEW');
    return Db.all('Authors').map(a => {
      const u = Db.findOne('Users', { id: a.user_id });
      return this.shape_(a, u || {});
    });
  },

  orcid_: function (v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(s)) throw new ApiFail('bad_orcid', 'format is 0000-0000-0000-0000');
    return s;
  },

  safeUrl_: function (v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) throw new ApiFail('bad_url', 'start with http:// or https://');
    return s.slice(0, 300);
  },

  shape_: function (a, u) {
    return {
      id: a.id, user_id: a.user_id, display_name: a.display_name, institution: a.institution,
      position: a.position, country: a.country, bio: a.bio, interests: a.interests,
      orcid: a.orcid, website: a.website, photo: a.photo,
      public: a.public === true || a.public === 'TRUE',
      email: u.email || '', status: u.status || ''
    };
  }
};
