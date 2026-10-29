/* ==========================================================================
   Site-wide settings shared by the generator (index.html) and the full
   report page (report.html).
   ========================================================================== */

const TypoConfig = (function () {
  // Where the site is published. Links that end up in a GitHub comment must
  // point to the public site, never to http://localhost:8000 — so when the
  // tool runs locally, this address is used instead of the current one.
  // On any other host (GitHub Pages, a fork…), the current address wins.
  const PUBLIC_SITE_URL = 'https://emmamarichal.github.io/gf-issues-dashboard/typo-guide/';

  // GitHub refuses comments longer than 65,536 characters, and the full
  // report link is part of the comment. A small margin is kept below it.
  const GITHUB_COMMENT_LIMIT = 65536;
  const COMMENT_BUDGET = 65000;

  function isLocal(loc) {
    loc = loc || window.location;
    return loc.protocol === 'file:' || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(loc.hostname);
  }

  // Base URL (ending with "/") to use in shared links.
  function publicBaseUrl() {
    if (isLocal()) return PUBLIC_SITE_URL;
    return new URL('.', window.location.href).href;
  }

  // Base URL of the copy of the site that is open right now — for previews.
  function currentBaseUrl() {
    return new URL('.', window.location.href).href;
  }

  return {
    PUBLIC_SITE_URL: PUBLIC_SITE_URL,
    GITHUB_COMMENT_LIMIT: GITHUB_COMMENT_LIMIT,
    COMMENT_BUDGET: COMMENT_BUDGET,
    isLocal: isLocal,
    publicBaseUrl: publicBaseUrl,
    currentBaseUrl: currentBaseUrl
  };
})();
