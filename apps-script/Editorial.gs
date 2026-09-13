/** Editorial.gs — the editor's side of the workflow.
 *
 *  Phase 2 defined what an author may do. This defines everything else, and the
 *  two sets do not overlap. Each edge carries the permission that opens it, so
 *  "can this person do this" is answered by a table rather than by scattered
 *  conditionals.
 *
 *  Two edges are deliberately absent from this file: APPROVED → PUBLISHED and
 *  APPROVED → SCHEDULED. Those belong to Publishing.gs and to the supervisor
 *  admin alone.
 */

const EDITOR_TRANSITIONS = [
  { from: 'SUBMITTED',             to: 'EDITOR_CHECK',          perm: 'REVIEW' },
  { from: 'RESUBMITTED',           to: 'EDITOR_CHECK',          perm: 'REVIEW' },
  { from: 'EDITOR_CHECK',          to: 'UNDER_REVIEW',          perm: 'REVIEW' },
  { from: 'EDITOR_CHECK',          to: 'REVISION_REQUIRED',     perm: 'REVIEW',               reason: true },
  { from: 'EDITOR_CHECK',          to: 'REJECTED',              perm: 'APPROVE',              reason: true },
  { from: 'UNDER_REVIEW',          to: 'REVISION_REQUIRED',     perm: 'REVIEW',               reason: true },
  { from: 'UNDER_REVIEW',          to: 'VERIFIED',              perm: 'APPROVE' },
  { from: 'UNDER_REVIEW',          to: 'REJECTED',              perm: 'APPROVE',              reason: true },
  { from: 'VERIFIED',              to: 'READY_FOR_PUBLICATION', perm: 'PUBLISH_PREPARATION' },
  { from: 'READY_FOR_PUBLICATION', to: 'VERIFIED',              perm: 'PUBLISH_PREPARATION',  reason: true },
  { from: 'READY_FOR_PUBLICATION', to: 'APPROVED',              perm: 'FINAL_PUBLISH' },
  { from: 'PUBLISHED',             to: 'ARCHIVED',              perm: 'ARCHIVE',              reason: true }
];

/** Version states an editor still has work to do in. */
const EDITORIAL_OPEN = ['SUBMITTED', 'RESUBMITTED', 'EDITOR_CHECK', 'UNDER_REVIEW',
                        'REVISION_REQUIRED', 'VERIFIED', 'READY_FOR_PUBLICATION', 'APPROVED', 'SCHEDULED'];

const Editorial = {

  /** The editorial queue, narrowed to the sections the caller actually covers.
   *  A section editor scoped to energy-storage does not see materials. */
  queue: function (session, p) {
    Perms.require(session, 'REVIEW');
    const want = (p && p.status) ? [String(p.status)] : EDITORIAL_OPEN;
    const out = [];
    Db.all('Articles').forEach(a => {
      if (!Perms.has(session.user, 'REVIEW', a.category) &&
          !Perms.has(session.user, 'MANAGE', a.category)) return;
      const v = Db.findOne('Versions', { article_id: a.id, version: a.working_version });
      if (!v || want.indexOf(v.status) === -1) return;
      const author = Db.findOne('Users', { id: a.primary_author });
      out.push({
        id: a.id, title: a.title, category: a.category, format: a.format, level: a.level,
        article_status: a.status, version: Number(v.version), version_status: v.status,
        public_version: Number(a.public_version || 0),
        author: author ? author.name : '', author_id: a.primary_author,
        updated_at: a.updated_at, notes: v.notes || '',
        reviews: Db.find('Reviews', { article_id: a.id, version: v.version })
          .map(r => ({ id: r.id, reviewer_id: r.reviewer_id, status: r.status, decision: r.decision }))
      });
    });
    return out.sort((x, y) => String(x.updated_at).localeCompare(String(y.updated_at)));
  },

  /** Every editorial state change goes through here. */
  move: function (session, p) {
    const a = Articles.mustOwn_(session, p.article_id);   // write-side access
    // Gate first, table second. An author owns the article, so ownership alone
    // would let them probe which transitions exist; every editorial edge is
    // made by someone who can review, so that is the entry requirement.
    Perms.require(session, 'REVIEW', a.category);
    const v = Articles.workingVersion_(a);
    const to = String(p.to || '');
    const edge = EDITOR_TRANSITIONS.filter(e => e.from === v.status && e.to === to)[0];
    if (!edge) {
      throw new ApiFail('illegal_transition', v.status + ' cannot become ' + to);
    }
    Perms.require(session, edge.perm, a.category);
    const reason = String(p.reason || '').trim();
    if (edge.reason && reason.length < 10) {
      throw new ApiFail('reason_required', 'say why, in a sentence the author can act on');
    }
    return this.apply_(session, a, v, to, reason);
  },

  /** Shared by move() and by Reviews when a decision advances the state. */
  apply_: function (session, a, v, to, reason) {
    const patch = { status: to };
    if (reason) patch.notes = reason;
    if (to === 'APPROVED') { patch.approved_by = session.user.id; patch.approved_at = new Date().toISOString(); }
    Db.update('Versions', { id: v.id }, patch);

    // An article that has never been published mirrors its working version. One
    // that is live keeps its PUBLISHED status while a revision moves privately.
    if (Number(a.public_version || 0) === 0 || to === 'ARCHIVED') {
      Db.update('Articles', { id: a.id }, { status: to });
    }

    this.notifyAuthor_(session, a, v, to, reason);
    Audit.log(session, 'EDITORIAL_TRANSITION', 'article', a.id, {
      prev: v.status, next: to, scope: a.category, reason: reason,
      meta: { version: Number(v.version) }
    });
    return { ok: true, status: to, version: Number(v.version) };
  },

  /** Authors hear about the decisions that need them, and nothing else. */
  notifyAuthor_: function (session, a, v, to, reason) {
    const tellAuthor = { REVISION_REQUIRED: 1, REJECTED: 1, VERIFIED: 1, PUBLISHED: 1 };
    if (!tellAuthor[to]) return;
    const author = Db.findOne('Users', { id: a.primary_author });
    if (!author) return;
    const titles = {
      REVISION_REQUIRED: 'Revisions requested: ' + a.title,
      REJECTED: 'Not accepted: ' + a.title,
      VERIFIED: 'Review passed: ' + a.title
    };
    Notifications.push(author.id, 'decision', titles[to] || a.title, reason || '', 'articles');
    if (to === 'REVISION_REQUIRED' || to === 'REJECTED') {
      Email.send(author.email, to === 'REJECTED' ? 'article_rejected' : 'revision_requested', {
        author_name: author.name, article_title: a.title, article_id: a.id,
        editor_note: reason, portal_url: CFG.get('SITE_URL', '') + 'author/'
      }, session);
    }
  },

  /** What an editor needs on one screen: the article, its content, its reviews
   *  and the moves available to this particular person right now. */
  open: function (session, p) {
    const a = Articles.mustOwn_(session, p.article_id);
    const detail = Articles.get(session, p);
    const v = Articles.workingVersion_(a);
    return Object.assign(detail, {
      reviews: Reviews.forArticle(session, { article_id: a.id }),
      available: EDITOR_TRANSITIONS
        .filter(e => e.from === v.status && Perms.has(session.user, e.perm, a.category))
        .map(e => ({ to: e.to, needs_reason: !!e.reason })),
      author: (function () {
        const u = Db.findOne('Users', { id: a.primary_author });
        return u ? { id: u.id, name: u.name, institution: u.institution || '' } : null;
      })()
    });
  }
};
