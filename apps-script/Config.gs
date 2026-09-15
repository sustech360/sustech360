/** Config.gs — every secret lives in Script Properties, never in this file
 *  and never in the GitHub repository.
 *
 *  Required properties (⚙ Project Settings → Script Properties →
 *  Add script property → then press SAVE SCRIPT PROPERTIES):
 *    ENV                 'production' | 'beta'
 *    SPREADSHEET_ID      id of the data spreadsheet for THIS environment
 *    DRIVE_FOLDER_ID     media folder for THIS environment
 *    PASSWORD_PEPPER     long random string, unique per environment
 *    TOKEN_PEPPER        long random string, unique per environment
 *    SITE_URL            public site base URL
 *    GITHUB_REPO         'owner/repo' used by the publishing engine
 *    GITHUB_TOKEN        fine-grained PAT with contents:write on that repo only
 *    BOOTSTRAP_EMAIL     supervisor admin email, used once by setup()
 */
const CFG = {
  get: function (key, fallback) {
    const v = PropertiesService.getScriptProperties().getProperty(key);
    if (v == null && fallback === undefined) throw new Error('Missing script property: ' + key);
    return v == null ? fallback : v;
  },
  /** What the engine needs before it can do anything, and what each is for.
   *  Kept here so one list drives the check, the error message and the docs. */
  REQUIRED: [
    ['SPREADSHEET_ID', 'the id of your data spreadsheet — the code between /d/ and /edit'],
    ['DRIVE_FOLDER_ID', 'the id of your media folder — the code after /folders/'],
    ['PASSWORD_PEPPER', 'a long random string you invent, used to protect passwords'],
    ['TOKEN_PEPPER', 'a second long random string, different from the first'],
    ['SITE_URL', 'your site address, ending in a slash'],
    ['BOOTSTRAP_EMAIL', 'your email — the supervisor password is sent here once']
  ],

  OPTIONAL: [
    ['ENV', "'production' or 'beta' (defaults to beta)"],
    ['GITHUB_REPO', "owner/repo — needed before you can publish, not before setup"],
    ['GITHUB_TOKEN', 'the publishing token — added at a later step']
  ],

  /** Reports every missing property at once. The plain get() names only the
   *  first one it happens to need, which means fixing them one error at a
   *  time; this exists so setup() can say everything that is wrong in one go. */
  check: function () {
    const props = PropertiesService.getScriptProperties().getProperties();
    const missing = [], blank = [], present = [];
    CFG.REQUIRED.forEach(pair => {
      const raw = props[pair[0]];
      if (raw === undefined) missing.push(pair);
      else if (!String(raw).trim()) blank.push(pair);
      else present.push(pair[0]);
    });
    // A name typed in the wrong case is invisible otherwise: the property is
    // there, the engine cannot see it, and nothing explains why.
    // A name that is nearly right is worse than one that is absent: the row is
    // on the screen, it looks correct, and the engine cannot see it. Spaces
    // pasted from a document are the usual culprit, wrong case the next.
    const nearly = [];
    Object.keys(props).forEach(k => {
      const normalised = k.trim().toUpperCase();
      if (k === normalised) return;
      if (CFG.REQUIRED.concat(CFG.OPTIONAL).some(pair => pair[0] === normalised)) {
        nearly.push({ typed: k, meant: normalised });
      }
    });
    return { missing: missing, blank: blank, present: present, wrongCase: nearly };
  },

  /** Throws one message that says everything that is wrong and where to fix it. */
  requireAll_: function () {
    const state = CFG.check();
    if (!state.missing.length && !state.blank.length && !state.wrongCase.length) return true;
    const lines = ['Setup cannot run yet. The engine reads its settings from Script Properties.', ''];
    if (state.missing.length) {
      lines.push('MISSING — add these:');
      state.missing.forEach(p => lines.push('  ' + p[0] + '  —  ' + p[1]));
      lines.push('');
    }
    if (state.blank.length) {
      lines.push('EMPTY — these exist but have no value:');
      state.blank.forEach(p => lines.push('  ' + p[0]));
      lines.push('');
    }
    if (state.wrongCase.length) {
      lines.push('NEARLY RIGHT — these exist but are not what the engine looks for:');
      state.wrongCase.forEach(n => lines.push('  [' + n.typed + ']  should be  [' + n.meant + ']'));
      lines.push('  (the brackets show stray spaces; names are case-sensitive)');
      lines.push('');
    }
    lines.push('Where: ⚙ Project Settings (left sidebar) → scroll to Script Properties');
    lines.push('       → Add script property → fill both boxes');
    lines.push('       → press "Save script properties". Rows that are typed but');
    lines.push('         not saved do not exist, and this is the usual cause.');
    lines.push('');
    lines.push('Then run checkSetup() to confirm before running setup() again.');
    throw new Error(lines.join('\n'));
  },

  env: function () { return CFG.get('ENV', 'beta'); },
  isProduction: function () { return CFG.env() === 'production'; },
  book: function () { return SpreadsheetApp.openById(CFG.get('SPREADSHEET_ID')); }
};

const LIMITS = {
  SESSION_HOURS: 12,
  INVITE_DAYS: 14,
  PBKDF_ITERATIONS: 4000,   // SHA-256 chain; see docs/SECURITY notes on migration
  MAX_LOGIN_FAILURES: 5,
  LOCKOUT_MINUTES: 15,
  MAX_PAYLOAD_BYTES: 900000,
  EMERGENCY_MAX_HOURS: 24,
  MAIL_BATCH: 40,        // messages per execution: Apps Script has ~6 minutes
  MAIL_RESERVE: 50,      // quota kept back so invitations and password resets
                         // keep working while a newsletter is going out
  MAX_MEDIA_BYTES: 6000000,          // base64 envelope; ~4.4 MB of actual image
  MEDIA_MIME: ['image/jpeg','image/png','image/webp','image/avif'],
  MIN_IMAGE_PIXELS: 800,             // advisory, checked in the portal
  INVITE_LOOKUP_ATTEMPTS: 10,        // per invitation id per hour
  AUTOSAVE_SECONDS: 20
};

const SUPERVISOR_ROLE = 'SUPERVISOR_ADMIN';
