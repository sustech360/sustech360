/** Schema.gs — table definitions and one-time environment setup.
 *  Columns are declared here, never assumed by position elsewhere. */

const SCHEMA = {
  Users: ['id','email','name','password_hash','password_salt','role_id','status','mfa_secret','mfa_enabled',
          'session_epoch','failed_attempts','locked_until','institution','country','created_at','updated_at','deleted_at'],
  Roles: ['id','name','description','system','created_at','updated_at','deleted_at'],
  RolePermissions: ['id','role_id','permission','scope','created_at'],
  UserGrants: ['id','user_id','permission','scope','starts_at','expires_at','reason','granted_by','created_at'],
  Sessions: ['id','token_hash','user_id','epoch','created_at','expires_at','revoked_at','ip','user_agent'],
  Authors: ['id','user_id','display_name','institution','position','country','bio','interests','orcid','website','photo','public','created_at','updated_at'],
  AuthorInvitations: ['id','token_hash','name','email','institution','country','expertise','section','format','message',
                      'invited_by','created_at','expires_at','status','accepted_at','revoked_at'],
  Articles: ['id','slug','title','category','topics','tags','level','format','status','public_version','working_version',
             'primary_author','co_authors','created_by','created_at','updated_at','published_at','scheduled_for','sponsored'],
  Versions: ['id','article_id','version','payload_ref','status','created_by','created_at','approved_by','approved_at','notes'],
  Reviews: ['id','article_id','version','reviewer_id','decision','comments','created_at','completed_at','assigned_by','due_at','status'],
  Menus: ['id','menu','name','url','parent','order','icon','status','scope','assigned_editor','updated_at'],
  Homepage: ['id','section_id','type','title','source','count','layout','order','active','starts','ends','items','placement','updated_at'],
  Categories: ['slug','name','parent','description','order','status'],
  Features: ['flag','state','starts','ends','locked','note','updated_at'],
  Settings: ['key','value','scope','updated_by','updated_at'],
  Guidelines: ['id','kind','version','title','body_ref','status','created_by','created_at','approved_by','approved_at','notes','published_at','updated_at'],
  ArticleFormats: ['id','slug','name','description','status','order'],
  FormatFields: ['id','format_id','field','label','required','order','help','status'],
  SubmissionChecklist: ['id','item','required','order','status'],
  AdPlacements: ['id','name','description','chain','active','updated_at'],
  AdCreatives: ['id','name','placement','tier','campaign_id','advertiser_id','drive_id','file','url','alt','label','weight','targeting','starts','ends','status','created_by','created_at','approved_by','approved_at','notes'],
  Advertisers: ['id','company','contact','email','website','country','status','notes','created_at','created_by'],
  Campaigns: ['id','advertiser_id','name','package','tier','starts','ends','status','created_at','created_by','approved_by','approved_at','notes'],
  Subscribers: ['id','email','name','token_hash','status','source','topics','created_at','confirmed_at','unsubscribed_at','last_sent_at','failures'],
  EmailTemplates: ['id','key','subject','body_ref','version','status','updated_at'],
  EmailLogs: ['id','to','template','subject','status','error','sent_at','sent_by'],
  EmailCampaigns: ['id','subject','preheader','body_ref','status','audience','created_by','created_at','approved_by','approved_at','tested_at','tested_by','started_at','sent_at','cursor','sent_count','failed_count','note'],
  SocialPosts: ['id','article_id','platform','text','link','status','created_at','posted_at','posted_by','error','note'],
  MagazineIssues: ['id','number','slug','title','theme','month','year','cover_ref','cover_file','editorial_ref','contents','status','pdf_ref','pdf_file','pdf_built_at','created_by','created_at','updated_at','approved_by','approved_at','published_at','notes'],
  Backups: ['id','kind','location','size','created_by','created_at','verified_at'],
  AdEvents: ['id','day','placement','creative_id','impressions','clicks','updated_at'],
  /* --- phase 10: billing --- */
  Customers: ['id','name','advertiser_id','email','billing_address','tax_id','country','currency','status','created_at','created_by','notes'],
  Products: ['id','sku','name','kind','description','unit_price','currency','tax_rate','status','created_at'],
  Orders: ['id','customer_id','campaign_id','lines','currency','subtotal','tax','total','status','created_at','created_by','note'],
  Invoices: ['id','number','order_id','customer_id','issued_at','due_at','currency','subtotal','tax','total','paid','status','lines','tax_note','pdf_ref','issued_by','voided_at','voided_by','void_reason','credit_of','notes'],
  Payments: ['id','invoice_id','amount','currency','method','reference','received_at','recorded_by','verified_by','verified_at','note'],

  Vitals: ['id','day','page','metric','device','count','sum','worst','buckets','updated_at'],
  ConfigVersions: ['id','version','created_by','created_at','note','ref','live','reason'],
  SearchDocs: ['article_id','slug','title','summary','category','keywords','published_at','reading_minutes','authors','deleted_at'],
  AuditLogs: ['id','ts','user_id','user_email','action','object_type','object_id','prev_version','new_version','scope','reason','meta'],

  /* --- phase 2 --- */
  Notifications: ['id','user_id','kind','title','body','link','read_at','created_at'],
  Media: ['id','owner_id','article_id','drive_id','name','mime','bytes','credit','licence','caption','status','created_at','deleted_at']
};

/** Run once per environment from the Apps Script editor. Idempotent. */
function setup() {
  CFG.requireAll_();          // says everything that is missing, in one message
  const ss = CFG.book();
  Object.keys(SCHEMA).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const cols = SCHEMA[name];
    const head = sh.getRange(1, 1, 1, cols.length);
    head.setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  seedRoles_();
  seedEditorial_();
  seedSite_();
  seedBilling_();
  seedAds_();
  bootstrapSupervisor_();
  Audit.log(null, 'SETUP', 'environment', CFG.env(), { reason: 'initial setup' });
  return 'Setup complete for ' + CFG.env();
}

/** Run this before setup() if anything looks wrong. It changes nothing — it
 *  reports what the engine can and cannot see, and never prints a secret. */
function checkSetup() {
  const state = CFG.check();
  const out = ['', 'SusTech360 — settings check', ''];

  CFG.REQUIRED.forEach(pair => {
    const ok = state.present.indexOf(pair[0]) !== -1;
    out.push((ok ? '  OK      ' : '  MISSING ') + pair[0] + (ok ? '' : '  —  ' + pair[1]));
  });
  CFG.OPTIONAL.forEach(pair => {
    const raw = PropertiesService.getScriptProperties().getProperty(pair[0]);
    out.push((raw ? '  OK      ' : '  later   ') + pair[0] + (raw ? '' : '  —  ' + pair[1]));
  });

  if (state.wrongCase.length) {
    out.push('', 'Typed in the wrong case — the engine cannot see these:');
    state.wrongCase.forEach(k => out.push('  ' + k + '  should be  ' + k.toUpperCase()));
  }

  const ready = !state.missing.length && !state.blank.length && !state.wrongCase.length;
  out.push('');
  if (ready) {
    out.push('Ready. Run setup() next.');
    try {
      SpreadsheetApp.openById(CFG.get('SPREADSHEET_ID'));
      out.push('The spreadsheet opens.');
    } catch (e) {
      out.push('BUT the spreadsheet will not open. Check SPREADSHEET_ID is the id');
      out.push('only — the code between /d/ and /edit — not the whole address.');
    }
    try {
      DriveApp.getFolderById(CFG.get('DRIVE_FOLDER_ID'));
      out.push('The media folder opens.');
    } catch (e) {
      out.push('BUT the media folder will not open. Check DRIVE_FOLDER_ID is the');
      out.push('code after /folders/ in the address.');
    }
  } else {
    out.push('Not ready. Add what is marked MISSING:');
    out.push('  Project Settings (the gear, left sidebar) → Script Properties');
    out.push('  → Add script property → fill both boxes');
    out.push('  → press "Save script properties"  ← the step people miss');
  }
  const report = out.join('\n');
  console.log(report);
  return report;
}

function seedRoles_() {
  const roles = [
    [SUPERVISOR_ROLE, 'Highest authority. Sole holder of FINAL_PUBLISH.', true],
    ['ADMINISTRATOR', 'Platform administration, no final publish.', true],
    ['SENIOR_EDITOR', 'Editorial oversight across sections.', true],
    ['SECTION_EDITOR', 'Editorial control within an assigned scope.', true],
    ['REVIEWER', 'Reviews assigned submissions.', true],
    ['AUTHOR', 'Writes and submits own articles.', true],
    ['ADVERTISING_MANAGER', 'Manages campaigns and creatives.', true],
    ['ANALYTICS_MANAGER', 'Reads analytics and performance.', true],
    ['MODERATOR', 'Moderates reader-facing content.', true]
  ];
  roles.forEach(r => {
    if (!Db.findOne('Roles', { id: r[0] })) {
      Db.insert('Roles', { id: r[0], name: r[0], description: r[1], system: r[2] });
    }
  });

  const grants = {
    SUPERVISOR_ADMIN: PERMISSIONS.slice(),
    ADMINISTRATOR: PERMISSIONS.filter(p => p !== 'FINAL_PUBLISH'),
    SENIOR_EDITOR: ['VIEW','CREATE','EDIT','REVIEW','APPROVE','PUBLISH_PREPARATION','ARCHIVE','EXPORT','INVITE_AUTHOR'],
    SECTION_EDITOR: ['VIEW','CREATE','EDIT','REVIEW','PUBLISH_PREPARATION','INVITE_AUTHOR'],
    REVIEWER: ['VIEW','REVIEW'],
    AUTHOR: ['VIEW','CREATE','EDIT'],
    ADVERTISING_MANAGER: ['VIEW','CREATE','EDIT','MANAGE'],
    ANALYTICS_MANAGER: ['VIEW','EXPORT'],
    MODERATOR: ['VIEW','EDIT']
  };
  Object.keys(grants).forEach(roleId => {
    grants[roleId].forEach(p => {
      if (!Db.findOne('RolePermissions', { role_id: roleId, permission: p })) {
        Db.insert('RolePermissions', { role_id: roleId, permission: p, scope: '*' });
      }
    });
  });
}

/** Creates the single supervisor admin if none exists. A one-time password is
 *  mailed to BOOTSTRAP_EMAIL; it must be changed at first login. */
function bootstrapSupervisor_() {
  const existing = Db.find('Users', { role_id: SUPERVISOR_ROLE }).filter(u => u.status !== 'DELETED');
  if (existing.length) return;
  const email = CFG.get('BOOTSTRAP_EMAIL');
  const temp = Auth.randomToken().slice(0, 16);
  const salt = Auth.randomToken().slice(0, 24);
  Db.insert('Users', {
    id: Db.newId('USR'), email: String(email).toLowerCase().trim(), name: 'Supervisor Admin',
    password_hash: Auth.hashPassword(temp, salt), password_salt: salt,
    role_id: SUPERVISOR_ROLE, status: 'PASSWORD_RESET_REQUIRED', mfa_enabled: false,
    session_epoch: 1, failed_attempts: 0
  });
  MailApp.sendEmail(email, 'Supervisor admin account created',
    'A supervisor admin account was created for ' + CFG.env() + '.\n\n' +
    'Temporary password: ' + temp + '\n\nIt must be changed at first sign-in. ' +
    'If you did not run setup, tell your technical administrator immediately.');
}


/** Editorial defaults: article formats, their fields, the submission checklist
 *  and a first guidelines version. All of it is data, so the Guidelines Centre
 *  in phase 4 edits these rows rather than any code. */
function seedEditorial_() {
  const formats = [
    ['research-highlight', 'Research Highlight', 'A recent result, explained for a wider technical audience.', 900, 1600],
    ['technology-explained', 'Technology Explained', 'How something works, and what limits it.', 1000, 1800],
    ['expert-opinion', 'Expert Opinion', 'An argued position from a named specialist.', 700, 1400],
    ['industry-insight', 'Industry Insight', 'What is happening commercially and why it matters.', 800, 1500],
    ['sustainability-case-study', 'Sustainability Case Study', 'A specific deployment, with outcomes.', 900, 1700],
    ['interview', 'Interview', 'Edited conversation with a practitioner.', 800, 2000],
    ['news-analysis', 'News Analysis', 'An event plus the context that explains it.', 600, 1200],
    ['innovation-spotlight', 'Innovation Spotlight', 'An emerging technology or group.', 600, 1200],
    ['review-commentary', 'Review / Commentary', 'A survey of a field or a response to published work.', 1200, 2500],
    ['young-researcher', 'Student / Young Researcher Feature', 'Early-career work, written accessibly.', 700, 1400]
  ];
  formats.forEach((f, i) => {
    if (Db.findOne('ArticleFormats', { slug: f[0] })) return;
    const rec = Db.insert('ArticleFormats', {
      id: Db.newId('FMT'), slug: f[0], name: f[1], description: f[2], status: 'ACTIVE', order: i + 1
    });
    (FORMAT_FIELDS_[f[0]] || FORMAT_FIELDS_.default).forEach((fld, j) => {
      Db.insert('FormatFields', {
        id: Db.newId('FLD'), format_id: rec.id, field: fld[0], label: fld[1],
        required: fld[2], order: j + 1, help: fld[3] || ''
      });
    });
    Db.insert('Settings', { key: 'formats.' + f[0] + '.words', value: JSON.stringify({ recommended: f[3], max: f[4] }), scope: 'editorial' });
  });

  const checklist = [
    ['The article is original and not published elsewhere.', true],
    ['All sources and prior work are referenced.', true],
    ['Figures are mine, or I hold permission to publish them.', true],
    ['Any conflict of interest is declared.', true],
    ['AI use is declared where it applies.', true],
    ['Author details and affiliation are correct.', true],
    ['The article follows the selected format and word count.', true]
  ];
  checklist.forEach((c, i) => {
    if (Db.findOne('SubmissionChecklist', { item: c[0] })) return;
    Db.insert('SubmissionChecklist', { id: Db.newId('CHK'), item: c[0], required: c[1], order: i + 1, status: 'ACTIVE' });
  });

  if (!Db.findOne('Guidelines', { kind: 'AUTHOR', version: '1.0' })) {
    Db.insert('Guidelines', {
      id: Db.newId('GDL'), kind: 'AUTHOR', version: '1.0', title: 'Author guidelines v1.0',
      body_ref: '', status: 'PUBLISHED', created_by: 'SYSTEM', approved_by: 'SYSTEM',
      approved_at: new Date().toISOString()
    });
  }
}

/** Field sets per format. Phase 4 moves editing of these into the control
 *  centre; the shape does not change. */
const FORMAT_FIELDS_ = {
  'research-highlight': [
    ['summary', 'Short summary', true, 'Two or three sentences a non-specialist can follow.'],
    ['background', 'Background', true, 'What was already known.'],
    ['findings', 'Key findings', true, ''],
    ['significance', 'Significance', true, 'Why this changes anything.'],
    ['applications', 'Applications', false, ''],
    ['future', 'Future prospects', false, ''],
    ['references', 'References', true, 'One per line.']
  ],
  'technology-explained': [
    ['summary', 'Short summary', true, ''],
    ['introduction', 'Introduction', true, ''],
    ['how', 'How it works', true, ''],
    ['materials', 'Technology and materials', true, ''],
    ['advantages', 'Advantages', true, ''],
    ['limitations', 'Limitations', true, 'Be specific; this is the section readers trust you for.'],
    ['applications', 'Applications', false, ''],
    ['future', 'Future prospects', false, ''],
    ['references', 'References', true, '']
  ],
  'expert-opinion': [
    ['summary', 'Short summary', true, ''],
    ['introduction', 'Introduction', true, ''],
    ['discussion', 'Main discussion', true, ''],
    ['perspective', 'Expert perspective', true, ''],
    ['challenges', 'Challenges', false, ''],
    ['recommendations', 'Recommendations', true, ''],
    ['conclusion', 'Conclusion', true, '']
  ],
  'interview': [
    ['summary', 'Short summary', true, ''],
    ['subject', 'Who you spoke to', true, 'Name, role, institution.'],
    ['transcript', 'Edited conversation', true, 'Mark questions with Q: and answers with A:'],
    ['context', 'Context', false, '']
  ],
  default: [
    ['summary', 'Short summary', true, ''],
    ['introduction', 'Introduction', true, ''],
    ['body', 'Main text', true, ''],
    ['conclusion', 'Conclusion', false, ''],
    ['references', 'References', false, '']
  ]
};


/** Seeds the configuration tables so a fresh install publishes the site it
 *  ships with rather than an empty one. Every row is keyed, so this is safe to
 *  re-run: it fills gaps and never overwrites a decision someone has made. */
function seedAds_() {
  const placements = [
    ['RAIL_LEFT', 'Left rail, wide screens only'],
    ['RAIL_RIGHT', 'Right rail, wide screens only'],
    ['HOME_TOP', 'Homepage, above the lead'],
    ['HOME_AFTER_FEATURED', 'Homepage, after the lead story'],
    ['HOME_MIDDLE', 'Homepage, between sections'],
    ['HOME_SIDEBAR', 'Homepage sidebar'],
    ['ARTICLE_TOP', 'Article, above the headline'],
    ['ARTICLE_MIDDLE', 'Article, mid-text'],
    ['ARTICLE_SIDEBAR', 'Article sidebar'],
    ['CATEGORY_TOP', 'Section page, above the list'],
    ['MAGAZINE_COVER', 'Magazine issue, inside cover'],
    ['BACK_COVER', 'Magazine issue, back cover']
  ];
  const chain = ['DIRECT', 'PREMIUM', 'STANDARD', 'ADSENSE', 'HOUSE', 'MAGAZINE', 'RELATED', 'COLLAPSE'];
  placements.forEach(p => {
    if (Db.findOne('AdPlacements', { id: p[0] })) return;
    Db.insert('AdPlacements', {
      id: p[0], name: p[0], description: p[1], chain: JSON.stringify(chain),
      active: false, updated_at: new Date().toISOString()
    });
  });
}

function seedBilling_() {
  const products = [
    ['ADV-LEADER', 'Leaderboard, one month', 'AD_PACKAGE', 4000000, 1800, 'Top of the homepage and article pages for one calendar month.'],
    ['ADV-SIDEBAR', 'Sidebar, one month', 'AD_PACKAGE', 2500000, 1800, 'Article sidebar for one calendar month.'],
    ['ADV-NEWSLETTER', 'Newsletter sponsorship, one issue', 'SPONSORSHIP', 1500000, 1800, 'One sponsored placement in a weekly newsletter.'],
    ['ADV-ISSUE', 'Magazine issue, full page', 'AD_PACKAGE', 6000000, 1800, 'A full page in one magazine issue, web and PDF.']
  ];
  products.forEach(p => {
    if (Db.findOne('Products', { sku: p[0] })) return;
    Db.insert('Products', {
      id: Db.newId('PRD'), sku: p[0], name: p[1], kind: p[2],
      unit_price: p[3], currency: 'INR', tax_rate: p[4], description: p[5], status: 'ACTIVE'
    });
  });
  const settings = [
    ['billing.currency', 'INR'],
    ['billing.tax_label', 'GST'],
    ['billing.fy_start_month', '4'],
    ['billing.payment_terms_days', '30'],
    ['billing.require_payment_before_live', 'false'],
    ['billing.seller', JSON.stringify({ name: '', address: '', tax_id: '', email: '' })]
  ];
  settings.forEach(kv => {
    if (Db.findOne('Settings', { key: kv[0] })) return;
    Db.insert('Settings', { key: kv[0], value: kv[1], scope: 'billing' });
  });
}

function seedSite_() {
  const menus = [
    ['m-energy', 'primary', 'Energy', 'category.html?c=energy', '', 1, 'ACTIVE'],
    ['m-storage', 'primary', 'Energy storage', 'category.html?c=energy-storage', 'm-energy', 1, 'ACTIVE'],
    ['m-renew', 'primary', 'Renewables', 'category.html?c=renewable-energy', 'm-energy', 2, 'ACTIVE'],
    ['m-sust', 'primary', 'Sustainability', 'category.html?c=sustainability', '', 2, 'ACTIVE'],
    ['m-mat', 'primary', 'Materials', 'category.html?c=materials', '', 3, 'ACTIVE'],
    ['m-res', 'primary', 'Research', 'category.html?c=research', '', 4, 'ACTIVE'],
    ['m-pol', 'primary', 'Policy', 'category.html?c=policy', '', 5, 'PAUSED'],
    ['m-about', 'primary', 'About', 'about.html', '', 6, 'ACTIVE'],
    ['m-issues', 'primary', 'Issues', 'issues.html', '', 7, 'ACTIVE'],
    ['f-guide', 'footer', 'How we work', 'guidelines.html', '', 1, 'ACTIVE'],
    ['f-policy', 'footer', 'Editorial policy', 'guidelines.html#g-review', '', 2, 'ACTIVE'],
    ['f-privacy', 'footer', 'Privacy', 'privacy.html', '', 3, 'ACTIVE'],
    ['f-rss', 'footer', 'RSS', 'rss/feed.xml', '', 4, 'ACTIVE']
  ];
  menus.forEach(m => {
    if (Db.findOne('Menus', { id: m[0] })) return;
    Db.insert('Menus', { id: m[0], menu: m[1], name: m[2], url: m[3], parent: m[4], order: m[5], status: m[6], scope: '' });
  });

  const sections = [
    ['lead', 'hero', '', 'latest', 1, 'lead', 1, true],
    ['ad-top', 'ad', '', 'HOME_TOP', 0, '', 2, true],
    ['latest', 'list', 'Latest', 'latest', 6, 'rows', 3, true],
    ['storage', 'list', 'Energy storage', 'category:energy-storage', 4, 'grid', 4, true],
    ['research', 'list', 'Research highlights', 'format:research-highlight', 3, 'rows', 5, true],
    ['newsletter', 'newsletter', 'The weekly brief', '', 0, '', 6, true]
  ];
  sections.forEach(x => {
    if (Db.findOne('Homepage', { section_id: x[0] })) return;
    Db.insert('Homepage', {
      id: Db.newId('SEC'), section_id: x[0], type: x[1], title: x[2], source: x[3],
      count: x[4], layout: x[5], order: x[6], active: x[7], items: '[]',
      placement: x[1] === 'ad' ? x[3] : ''
    });
  });

  const categories = [
    ['energy', 'Energy', '', 'Generation, conversion, storage and delivery.', 1],
    ['energy-storage', 'Energy storage', 'energy', 'Batteries, capacitors and thermal storage.', 2],
    ['renewable-energy', 'Renewable energy', 'energy', 'Solar, wind, hydro, geothermal, ocean.', 3],
    ['sustainability', 'Sustainability', '', 'Circular economy, climate, resources.', 4],
    ['materials', 'Materials', '', 'The substances that set the limits.', 5],
    ['research', 'Research', '', 'What the literature is showing now.', 6],
    ['policy', 'Policy', '', 'Regulation, incentives, standards.', 7]
  ];
  categories.forEach(c => {
    if (Db.findOne('Categories', { slug: c[0] })) return;
    Db.insert('Categories', { slug: c[0], name: c[1], parent: c[2], description: c[3], order: c[4], status: 'ACTIVE' });
  });

  const flags = [
    ['ADVERTISING', 'disabled', false], ['NEWSLETTER', 'enabled', false],
    ['COMMENTS', 'disabled', false], ['PDF', 'disabled', false],
    ['SOCIAL', 'enabled', false], ['JOBS', 'disabled', false],
    ['EVENTS', 'disabled', false], ['MEMBERSHIP', 'disabled', false],
    ['AUTHOR_REGISTRATION', 'disabled', true]
  ];
  flags.forEach(f => {
    if (Db.findOne('Features', { flag: f[0] })) return;
    Db.insert('Features', {
      flag: f[0], state: f[1], locked: f[2],
      note: f[2] ? 'Invitation-only by policy. Cannot be enabled.' : '',
      updated_at: new Date().toISOString()
    });
  });

  const settings = [
    ['brand.name', 'Sustainable Science, Technology and Solutions 360'],
    ['brand.tagline', 'Research, technology and policy for the energy transition'],
    ['brand.logo', 'assets/icons/logo.svg'],
    ['brand.logo_dark', 'assets/icons/logo-dark.svg'],
    ['brand.short_name', 'SusTech360'],
    ['appearance.tokens', JSON.stringify({
      '--paper': '#FCFCFA', '--ink': '#13212E', '--muted': '#5A6670',
      '--rule': '#D9D6CE', '--accent': '#1F6F5C', '--sponsor': '#8A6A1F'
    })],
    ['appearance.default_theme', 'light'],
    ['seo.site_url', CFG.get('SITE_URL', '')],
    ['seo.publisher', 'Sustainable Science, Technology and Solutions 360'],
    ['analytics.ga4_id', ''],
    ['ads.adsense_client', ''],
    ['ads.enabled', 'false'],
    ['contact.editorial', CFG.get('BOOTSTRAP_EMAIL', '')],
    ['reading.allow_pdf_download', 'true'],
    ['reading.allow_print', 'true'],
    ['reading.copy_notice', 'Quote freely with attribution and a link. Republishing in full needs permission.']
  ];
  settings.forEach(kv => {
    if (Db.findOne('Settings', { key: kv[0] })) return;
    Db.insert('Settings', { key: kv[0], value: kv[1], scope: 'site' });
  });
}
