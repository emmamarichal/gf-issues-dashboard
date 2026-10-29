/* ==========================================================================
   Fontspector, running in a Web Worker.

   Loads the WebAssembly build of Fontspector vendored in vendor/fontspector/
   (compiled from the official fontspector-web crate — see the README for
   how to rebuild it) and runs the Google Fonts profile on dropped fonts.
   Running in a worker keeps the page responsive while the checks run,
   which can take several seconds for a large family.

   Messages in:  { type: 'run', runId, files: { 'Name-Regular.ttf': Uint8Array, … },
                   profile: 'googlefonts' }
   Messages out: { type: 'ready', version }
                 { type: 'result', runId, version, familyName, results: [CheckResult…] }
                 { type: 'error', runId, error }
   ========================================================================== */

import init, { check_fonts, best_family_name, version } from '../vendor/fontspector/fontspector_web.js';

const ready = init().then(
  () => {
    self.postMessage({ type: 'ready', version: version() });
    return true;
  },
  (err) => {
    self.postMessage({ type: 'error', error: 'Could not load Fontspector: ' + String(err && err.message || err) });
    return false;
  }
);

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type !== 'run') return;

  if (!(await ready)) return; // the load error was already reported

  try {
    let familyName = '';
    try { familyName = best_family_name(msg.files); } catch (e) { /* cosmetic only */ }

    // full_lists=false: long lists (missing glyphs…) are truncated the same
    // way the official tool does by default. 'SKIP' = keep every severity,
    // so the summary can show the full count, not just the problems.
    const json = check_fonts(msg.files, msg.profile || 'googlefonts', false, 'SKIP');
    self.postMessage({
      type: 'result',
      runId: msg.runId,
      version: version(),
      familyName: familyName === 'Unknown' ? '' : familyName,
      results: JSON.parse(json)
    });
  } catch (err) {
    self.postMessage({ type: 'error', runId: msg.runId, error: String(err && err.message || err) });
  }
};
