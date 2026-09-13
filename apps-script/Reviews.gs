/** Reviews.gs — assignment and peer review.
 *
 *  A reviewer holds REVIEW but not EDIT, so they can read the version they were
 *  assigned and write a decision, and nothing else. Assignment is what grants
 *  the read; it is not a role, and it lapses when the review is cancelled.
 */

const REVIEW_DECISIONS = ['ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT'];

const Reviews = {

  /** Who can be asked. Anyone holding REVIEW in the section, minus the people
   *  who wrote it. */
  candidates: function (session, p) {
    Perms.require(session, 'REVIEW');
    const a = Articles.mustOwn_(session, p.article_id);
    const authors = [String(a.primary_author), String(a.created_by)]
      .concat(asList(a.co_authors).map(String));
    return Db.all('Users')
      .filter(u => Auth.isUsable(u) && authors.indexOf(String(u.id)) === -1)
      .filter(u => Perms.has(u, 'REVIEW', a.category))
      .map(u => ({ id: u.id, name: u.name, institution: u.institution || '', role_id: u.role_id }));
  },

  assign: function (session, p) {
    const a = Articles.mustOwn_(session, p.article_id);
    Perms.require(session, 'REVIEW', a.category);
    const v = Articles.workingVersion_(a);
    if (['EDITOR_CHECK', 'UNDER_REVIEW'].indexOf(v.status) === -1) {
      throw new ApiFail('not_reviewable', 'move it to editor check first');
    }
    const reviewer = Db.findOne('Users', { id: String(p.reviewer_id || '') });
    if (!Auth.isUsable(reviewer)) throw new ApiFail('not_found');

    // Conflict of interest: nobody reviews their own article, and nobody is
    // assigned who cannot review this section.
    const authors = [String(a.primary_author), String(a.created_by)].concat(asList(a.co_authors).map(String));
    if (authors.indexOf(String(reviewer.id)) !== -1) {
      Audit.log(session, 'REVIEW_SELF_ASSIGN_BLOCKED', 'article', a.id, { meta: { reviewer: reviewer.id } });
      throw new ApiFail('conflict_of_interest', 'an author cannot review their own article');
    }
    if (!Perms.has(reviewer, 'REVIEW', a.category)) throw new ApiFail('not_a_reviewer');
    if (Db.find('Reviews', { article_id: a.id, version: v.version, reviewer_id: reviewer.id })
          .some(r => r.status === 'PENDING')) {
      throw new ApiFail('already_assigned');
    }

    const due = p.due_at || new Date(Date.now() + 14 * 86400000).toISOString();
    const rec = Db.insert('Reviews', {
      id: Db.newId('REV'), article_id: a.id, version: Number(v.version), reviewer_id: reviewer.id,
      decision: '', comments: '', assigned_by: session.user.id, due_at: due, status: 'PENDING'
    });

    if (v.status === 'EDITOR_CHECK') Editorial.apply_(session, a, v, 'UNDER_REVIEW', '');

    Notifications.push(reviewer.id, 'review', 'Review requested: ' + a.title,
      'Due ' + String(due).slice(0, 10), 'reviews');
    Email.send(reviewer.email, 'review_request', {
      reviewer_name: reviewer.name, article_title: a.title, article_id: a.id,
      due_date: String(due).slice(0, 10), admin_url: CFG.get('SITE_URL', '') + 'admin/'
    }, session);
    Audit.log(session, 'REVIEWER_ASSIGNED', 'article', a.id,
      { scope: a.category, meta: { reviewer: reviewer.id, version: Number(v.version) } });
    return { ok: true, id: rec.id };
  },

  cancel: function (session, p) {
    const rec = Db.findOne('Reviews', { id: String(p.review_id || '') });
    if (!rec) throw new ApiFail('not_found');
    const a = Articles.mustOwn_(session, rec.article_id);
    Perms.require(session, 'REVIEW', a.category);
    if (rec.status !== 'PENDING') throw new ApiFail('already_completed');
    Db.update('Reviews', { id: rec.id }, { status: 'CANCELLED', completed_at: new Date().toISOString() });
    Audit.log(session, 'REVIEW_CANCELLED', 'article', a.id, { meta: { review: rec.id }, reason: p.reason || '' });
    return { ok: true };
  },

  /** A reviewer's own queue. */
  mine: function (session) {
    Perms.require(session, 'REVIEW');
    return Db.find('Reviews', { reviewer_id: session.user.id })
      .filter(r => r.status === 'PENDING')
      .map(r => {
        const a = Db.findOne('Articles', { id: r.article_id });
        return {
          id: r.id, article_id: r.article_id, version: Number(r.version), due_at: r.due_at,
          title: a ? a.title : '(removed)', category: a ? a.category : '', format: a ? a.format : ''
        };
      })
      .sort((x, y) => String(x.due_at).localeCompare(String(y.due_at)));
  },

  /** The version under review, without the other reviewers' opinions. */
  read: function (session, p) {
    const rec = Db.findOne('Reviews', { id: String(p.review_id || '') });
    if (!rec || String(rec.reviewer_id) !== String(session.user.id)) throw new ApiFail('not_found');
    if (rec.status !== 'PENDING') throw new ApiFail('already_completed');
    const a = Db.findOne('Articles', { id: rec.article_id });
    if (!a) throw new ApiFail('not_found');
    const v = Db.findOne('Versions', { article_id: a.id, version: rec.version });
    const format = Db.findOne('ArticleFormats', { slug: a.format });
    return {
      review: { id: rec.id, due_at: rec.due_at, version: Number(rec.version) },
      article: { id: a.id, title: a.title, category: a.category, format: a.format, level: a.level,
                 topics: asList(a.topics), tags: asList(a.tags) },
      fields: format ? Db.find('FormatFields', { format_id: format.id })
        .sort((x, y) => Number(x.order) - Number(y.order))
        .map(f => ({ field: f.field, label: f.label })) : [],
      content: v && v.payload_ref ? Articles.readPayload_(v.payload_ref) : { fields: {} }
    };
  },

  submit: function (session, p) {
    const rec = Db.findOne('Reviews', { id: String(p.review_id || '') });
    if (!rec || String(rec.reviewer_id) !== String(session.user.id)) throw new ApiFail('not_found');
    if (rec.status !== 'PENDING') throw new ApiFail('already_completed');
    const decision = String(p.decision || '');
    if (REVIEW_DECISIONS.indexOf(decision) === -1) throw new ApiFail('bad_decision');
    const comments = String(p.comments || '').trim();
    if (comments.length < 40) {
      throw new ApiFail('comments_required', 'a decision without reasoning is not a review');
    }

    Db.update('Reviews', { id: rec.id }, {
      decision: decision, comments: comments,
      status: 'COMPLETED', completed_at: new Date().toISOString()
    });

    const a = Db.findOne('Articles', { id: rec.article_id });
    Db.all('Users')
      .filter(u => Auth.isUsable(u) && Perms.has(u, 'APPROVE', a.category))
      .forEach(u => Notifications.push(u.id, 'review', 'Review in: ' + a.title,
        session.user.name + ' returned ' + decision, 'queue'));
    Audit.log(session, 'REVIEW_SUBMITTED', 'article', a.id,
      { next: decision, scope: a.category, meta: { review: rec.id, version: Number(rec.version) } });
    return { ok: true, decision: decision };
  },

  /** Editors see everything about the reviews; this is not a reviewer-facing
   *  call, so it requires editorial access to the article. */
  forArticle: function (session, p) {
    const a = Articles.mustOwn_(session, p.article_id);
    return Db.find('Reviews', { article_id: a.id }).map(r => {
      const u = Db.findOne('Users', { id: r.reviewer_id });
      return {
        id: r.id, version: Number(r.version), reviewer: u ? u.name : r.reviewer_id,
        reviewer_id: r.reviewer_id, status: r.status, decision: r.decision,
        comments: r.comments, due_at: r.due_at, completed_at: r.completed_at
      };
    }).sort((x, y) => Number(y.version) - Number(x.version));
  }
};
