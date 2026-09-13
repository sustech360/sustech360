/** Media.gs — author uploads.
 *
 *  Files land in the environment's Drive folder as PRIVATE. Nothing an author
 *  uploads is publicly reachable until publication copies it into the site
 *  repository, so an unpublished figure cannot leak through a guessed URL.
 */
const Media = {

  upload: function (session, p) {
    const a = Articles.mustOwn_(session, p.article_id);
    const rules = Formats.rules().media;
    const mime = String(p.mime || '');
    if (rules.mime.indexOf(mime) === -1) {
      throw new ApiFail('bad_type', 'accepted formats: ' + rules.mime.join(', '));
    }
    if ((rules.credit_required && !p.credit) || (rules.licence_required && !p.licence)) {
      throw new ApiFail('credit_required', 'every image needs a credit and a licence');
    }

    let bytes;
    try { bytes = Utilities.base64Decode(String(p.data || '')); }
    catch (e) { throw new ApiFail('bad_upload'); }
    if (!bytes.length) throw new ApiFail('bad_upload');
    if (bytes.length > rules.max_bytes) {
      throw new ApiFail('too_large', 'keep images under ' + Math.round(rules.max_bytes / 100000) / 10 + ' MB');
    }

    const name = String(p.name || 'figure').replace(/[^\w.\- ]/g, '').slice(0, 90);
    const blob = Utilities.newBlob(bytes, mime, a.id + '-' + name);
    const file = this.folder_().createFile(blob);
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);

    const rec = Db.insert('Media', {
      id: Db.newId('MED'), owner_id: session.user.id, article_id: a.id, drive_id: file.getId(),
      name: name, mime: mime, bytes: bytes.length, credit: String(p.credit).slice(0, 200),
      licence: String(p.licence).slice(0, 120), caption: String(p.caption || '').slice(0, 400),
      status: 'PRIVATE'
    });
    Audit.log(session, 'MEDIA_UPLOADED', 'media', rec.id, { meta: { article: a.id, bytes: bytes.length } });
    return { id: rec.id, name: name, bytes: bytes.length, mime: mime };
  },

  remove: function (session, p) {
    const rec = Db.findOne('Media', { id: p.media_id });
    if (!rec) throw new ApiFail('not_found');
    Articles.mustOwn_(session, rec.article_id);
    Db.softDelete('Media', { id: rec.id });          // the Drive file is kept
    Audit.log(session, 'MEDIA_REMOVED', 'media', rec.id, {});
    return { ok: true };
  },

  folder_: function () {
    const root = DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
    const it = root.getFoldersByName('media');
    return it.hasNext() ? it.next() : root.createFolder('media');
  }
};
