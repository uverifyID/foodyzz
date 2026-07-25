// Foodyzz contact form → Cloud Function (contactForm) → SMTP email to admin.
//
// The endpoint is the gen-2 Cloud Run URL of the `contactForm` function in the
// foodyzz-27b3e project (same host pattern as the other deployed functions).
// If the URL ever changes, `firebase functions:list` shows the current one.
var CONTACT_ENDPOINT = 'https://contactform-ja7ef4okna-uc.a.run.app';

(function () {
  var form = document.getElementById('contact-form');
  if (!form) return;
  var btn = document.getElementById('cf-submit');
  var status = document.getElementById('cf-status');

  function show(kind, msg) {
    status.className = 'form-status ' + kind;
    status.textContent = msg;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    // Native validation first (required/email/maxlength)
    if (!form.reportValidity()) return;

    var payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      topic: form.topic.value,
      message: form.message.value.trim(),
      website: form.website.value // honeypot — must stay empty
    };

    btn.disabled = true;
    btn.textContent = 'Sending…';
    status.className = 'form-status';

    try {
      var res = await fetch(CONTACT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        form.reset();
        show('ok', "Thanks — your message is on its way. We'll get back to you soon.");
      } else {
        show('err', (data && data.error) || 'Something went wrong. Please try again, or email privacy@foodyzz.com.');
      }
    } catch (err) {
      show('err', 'Network error — please check your connection and try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send message';
    }
  });
})();
