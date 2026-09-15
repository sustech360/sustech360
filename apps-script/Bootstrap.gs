/** Bootstrap.gs — two helpers for getting the engine started, and for the one
 *  failure that stops most installations: "Missing script property".
 *
 *  Neither is part of the running platform. Use them once and forget them.
 */

/** WHAT CAN THIS SCRIPT SEE?
 *
 *  Run this first when a property seems to be missing. It changes nothing and
 *  prints no secrets. The square brackets matter: a name with a stray space
 *  shows as [SPREADSHEET_ID ] and is a different property from [SPREADSHEET_ID],
 *  which is otherwise impossible to spot on the settings screen.
 */
function whatCanISee() {
  const store = PropertiesService.getScriptProperties();
  const all = store.getProperties();
  const keys = Object.keys(all);
  const secret = k => /PEPPER|TOKEN/.test(k);

  const out = ['', 'Properties this script can actually read: ' + keys.length, ''];
  if (!keys.length) {
    out.push('  (none)');
    out.push('');
    out.push('That means one of three things:');
    out.push('  1. The rows were typed but "Save script properties" was never pressed.');
    out.push('     This is the usual cause. The screen looks the same either way.');
    out.push('  2. They were added to a different Apps Script project. Check the');
    out.push('     project name at the top left is the one you are running.');
    out.push('  3. They were added under a Google account you are not signed in as.');
  } else {
    keys.sort().forEach(k => {
      out.push('  [' + k + '] = ' + (secret(k) ? '(hidden, ' + String(all[k]).length + ' characters)' : all[k]));
    });
  }

  out.push('');
  ['SPREADSHEET_ID', 'DRIVE_FOLDER_ID', 'PASSWORD_PEPPER', 'TOKEN_PEPPER',
   'SITE_URL', 'BOOTSTRAP_EMAIL'].forEach(k => {
    const exact = Object.prototype.hasOwnProperty.call(all, k);
    const nearly = keys.filter(x => x !== k && x.trim().toUpperCase() === k);
    out.push('  ' + (exact ? 'OK      ' : 'MISSING ') + k +
      (!exact && nearly.length ? '   — but [' + nearly[0] + '] exists. Spaces and case matter.' : ''));
  });

  const report = out.join('\n');
  console.log(report);
  return report;
}

/** SET THE SETTINGS FROM HERE INSTEAD
 *
 *  If the settings screen keeps refusing to hold on to your values, do it this
 *  way instead. It writes the same properties the screen would.
 *
 *    1. Replace each PASTE_ value below with your own.
 *    2. Choose setPropertiesOnce in the function dropdown and press Run.
 *    3. Read the log — it confirms what was written.
 *    4. Run whatCanISee() to double-check, then setup().
 *    5. COME BACK AND BLANK OUT THE VALUES in this file, then save.
 *
 *  Step 5 matters. Your peppers protect every password on the platform, and
 *  they should not sit in a code file any longer than this takes. They are safe
 *  from the public either way — this file never goes to GitHub — but a code
 *  file is the wrong home for them.
 */
function setPropertiesOnce() {
  const values = {
    SPREADSHEET_ID:  'PASTE_THE_CODE_BETWEEN_/d/_AND_/edit',
    DRIVE_FOLDER_ID: 'PASTE_THE_CODE_AFTER_/folders/',
    PASSWORD_PEPPER: 'PASTE_A_LONG_RANDOM_STRING',
    TOKEN_PEPPER:    'PASTE_A_DIFFERENT_LONG_RANDOM_STRING',
    SITE_URL:        'https://sustech360.com/',
    BOOTSTRAP_EMAIL: 'PASTE_YOUR_EMAIL',
    ENV:             'production'
    // GITHUB_REPO and GITHUB_TOKEN come later, at the publishing step.
  };

  const unfilled = Object.keys(values).filter(k => /^PASTE_/.test(values[k]));
  if (unfilled.length) {
    throw new Error('Fill these in first, in Bootstrap.gs: ' + unfilled.join(', '));
  }

  const clean = {};
  // Trim as we go: a space pasted from a document is invisible and breaks the
  // lookup exactly as a typo would.
  Object.keys(values).forEach(k => { clean[k.trim()] = String(values[k]).trim(); });
  PropertiesService.getScriptProperties().setProperties(clean, false);

  console.log('Written: ' + Object.keys(clean).join(', '));
  console.log('Now run whatCanISee() to confirm, then setup().');
  console.log('Then come back and blank out the values above.');
  return 'ok';
}

/** CAN THE ENGINE PUBLISH?
 *
 *  Run this when "Publish configuration" fails. It checks each link in the
 *  chain separately and says which one is broken, in words rather than a code.
 *  It writes one tiny file to your repository and deletes it again.
 */
function checkPublishing() {
  const out = ['', 'SusTech360 — publishing check', ''];
  const props = PropertiesService.getScriptProperties();
  const repo = (props.getProperty('GITHUB_REPO') || '').trim();
  const token = (props.getProperty('GITHUB_TOKEN') || '').trim();

  if (!repo) {
    out.push('  MISSING  GITHUB_REPO');
    out.push('           It should be owner/repo — for you, sustech360/sustech360');
    out.push('           Not the full web address, and no trailing slash.');
  } else if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    out.push('  WRONG    GITHUB_REPO is "' + repo + '"');
    out.push('           Expected two names with one slash: sustech360/sustech360');
  } else {
    out.push('  OK       GITHUB_REPO = ' + repo);
  }

  if (!token) {
    out.push('  MISSING  GITHUB_TOKEN');
    out.push('           Added at step 4.2. Remember "Save script properties".');
  } else {
    out.push('  OK       GITHUB_TOKEN is set (' + token.length + ' characters, starts ' +
             token.slice(0, 4) + '…)');
    if (token.length < 30) out.push('           That looks short — was the whole token copied?');
  }

  if (!repo || !token) {
    out.push('', 'Cannot test the connection until both are set.');
    console.log(out.join('\n'));
    return out.join('\n');
  }

  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // 1. Can the token see the repository at all?
  const look = UrlFetchApp.fetch('https://api.github.com/repos/' + repo,
    { headers: headers, muteHttpExceptions: true });
  const code = look.getResponseCode();
  out.push('');
  out.push('  Looking up the repository returned ' + code);

  if (code === 401) {
    out.push('  → The token is not valid. It may have been mistyped, truncated,');
    out.push('    revoked, or it has expired. Create a new one and paste it again.');
  } else if (code === 404) {
    out.push('  → GitHub will not admit this repository exists for this token.');
    out.push('    Either the name is wrong, or the token was not given access to it.');
    out.push('    With a fine-grained token you must pick the repository explicitly');
    out.push('    under "Only select repositories".');
    out.push('    If the repository belongs to an ORGANISATION, the organisation must');
    out.push('    also allow fine-grained tokens: organisation Settings → Personal');
    out.push('    access tokens → Allow access. Until it does, every request is a 404.');
    out.push('    The simpler route is a classic token with the "repo" scope.');
  } else if (code === 403) {
    out.push('  → Forbidden. Usually the organisation has not approved the token,');
    out.push('    or it lacks Contents permission. Check both.');
  } else if (code === 200) {
    const info = JSON.parse(look.getContentText());
    out.push('  → Found: ' + info.full_name + ', default branch "' + info.default_branch + '"');
    if (info.default_branch !== 'main') {
      out.push('    NOTE: the engine publishes to whatever branch GitHub Pages serves.');
      out.push('    If Pages is set to "main" but the default branch is "' +
               info.default_branch + '", make them match.');
    }

    // 2. Can it actually write? Nothing else proves Contents: Read and write.
    const probe = 'data/.publish-check.json';
    const url = 'https://api.github.com/repos/' + repo + '/contents/' + probe;
    const put = UrlFetchApp.fetch(url, {
      method: 'put', headers: headers, contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        message: 'Publishing check',
        content: Utilities.base64Encode('{"checked":"' + new Date().toISOString() + '"}',
                                        Utilities.Charset.UTF_8)
      })
    });
    const wrote = put.getResponseCode();
    out.push('');
    out.push('  Writing a test file returned ' + wrote);

    if (wrote === 201 || wrote === 200) {
      out.push('  → Publishing works. The engine can write to your website.');
      const sha = JSON.parse(put.getContentText()).content.sha;
      UrlFetchApp.fetch(url, {
        method: 'delete', headers: headers, contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({ message: 'Publishing check, cleaning up', sha: sha })
      });
      out.push('  → Test file removed.');
      out.push('');
      out.push('  Nothing is wrong with publishing. If the Control Centre still fails,');
      out.push('  the deployment is running older code: Deploy → Manage deployments');
      out.push('  → pencil → Version: New version → Deploy.');
    } else if (wrote === 403) {
      out.push('  → The token can read the repository but not write to it.');
      out.push('    Give it Contents: Read and write, not Read-only.');
    } else if (wrote === 404) {
      out.push('  → Write refused. Same causes as a 404 above: repository access');
      out.push('    or, for an organisation, token approval.');
    } else if (wrote === 409) {
      out.push('  → Conflict. The repository is empty — push at least one file first.');
    } else {
      out.push('  → Unexpected. GitHub said: ' + put.getContentText().slice(0, 200));
    }
  } else {
    out.push('  → Unexpected. GitHub said: ' + look.getContentText().slice(0, 200));
  }

  const report = out.join('\n');
  console.log(report);
  return report;
}

/** ADD THE TWO PUBLISHING SETTINGS
 *
 *  Step 4.2 in the install guide, done from here instead of the settings
 *  screen. Only these two are touched; everything already saved stays.
 *
 *    1. Put your repository and token in below.
 *    2. Choose setPublishingSettings and press Run.
 *    3. Run checkPublishing to confirm.
 *    4. Come back and blank out the token.
 */
function setPublishingSettings() {
  const repo = 'sustech360/sustech360';        // owner/repo — two names, one slash
  const token = 'PASTE_YOUR_GITHUB_TOKEN';     // from GitHub → Settings → Developer settings

  if (/^PASTE_/.test(token)) throw new Error('Put your token in first, in Bootstrap.gs');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
    throw new Error('GITHUB_REPO must be owner/repo, not a web address: ' + repo);
  }

  // `false` here means: leave every other property alone.
  PropertiesService.getScriptProperties().setProperties({
    GITHUB_REPO: repo.trim(),
    GITHUB_TOKEN: token.trim()
  }, false);

  console.log('Saved GITHUB_REPO and GITHUB_TOKEN.');
  console.log('Now run checkPublishing(). Then blank the token out of this file.');
  return 'ok';
}
