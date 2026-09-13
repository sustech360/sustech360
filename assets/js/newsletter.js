/* newsletter.js — the page an unsubscribe or confirmation link lands on.
 *
 * Unsubscribing has to work for someone who has no account, is not signed in,
 * is on a phone, and is already annoyed. So it happens on load: no button to
 * find, no form to submit, no second page. Confirming is the same.
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var action = params.get('action');
  var headline = document.getElementById('headline');
  var detail = document.getElementById('detail');
  var actions = document.getElementById('actions');

  var WORDS = {
    unsubscribe: { verb: 'unsubscribe', working: 'Removing you from the list' },
    confirm: { verb: 'confirm', working: 'Confirming your subscription' }
  };

  function api() {
    return MAG.admin(window.MAG_ENDPOINT);
  }

  function show(title, text, links) {
    headline.textContent = title;
    detail.textContent = text;
    actions.innerHTML = (links || []).map(function (l) {
      return '<a class="btn" href="' + l.href + '">' + l.text + '</a> ';
    }).join('');
  }

  var word = WORDS[action];
  if (!word || !params.get('id') || !params.get('t')) {
    show('That link is not complete',
      'Check you copied the whole address from the email, including everything after the question mark.',
      [{ href: MAG.join('index.html'), text: 'Go to the homepage' }]);
    return;
  }

  headline.textContent = word.working + '…';

  api().call(action === 'confirm' ? 'confirmSubscription' : 'unsubscribe', {
    id: params.get('id'), token: params.get('t')
  }).then(function (res) {
    if (action === 'unsubscribe') {
      show('Done — you are unsubscribed',
        res.message || 'You will not get another newsletter. Nothing else about your record changes.',
        [{ href: MAG.join('index.html'), text: 'Back to the magazine' }]);
    } else {
      show('You are on the list',
        res.message || 'Every email we send has an unsubscribe link at the bottom.',
        [{ href: MAG.join('index.html'), text: 'Start reading' }]);
    }
  }).catch(function (e) {
    if (e && e.code === 'invalid_link') {
      show('That link has expired',
        action === 'unsubscribe'
          ? 'If you are still getting emails, reply to any one of them and we will remove you by hand.'
          : 'Confirmation links are single use. Subscribe again from the homepage and we will send a fresh one.',
        [{ href: MAG.join('index.html'), text: 'Go to the homepage' }]);
      return;
    }
    show('Something went wrong at our end',
      'Nothing has changed. Try the link again in a minute, or reply to the email and a person will sort it out.',
      [{ href: MAG.join('index.html'), text: 'Go to the homepage' }]);
  });
})();
