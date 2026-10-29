/* ==========================================================================
   Typo Guide Generator — app logic
   No data is ever sent to a server: everything happens in the browser
   (reading the repo's JSON/Markdown files, running Fontspector, reading
   dropped screenshots, building the GitHub comment and the report link).

   Output: a Markdown checklist for a GitHub comment (js/github-comment.js)
   that links to report.html#?<payload>, the full report stored in the link
   itself (js/urlhosted.js). Opening index.html#?<payload> loads a report
   back into the generator to edit it.
   ========================================================================== */

(function () {
  'use strict';

  const state = {
    problems: [],
    linksDb: [],
    tutorialsDb: [],
    selectedProblemIds: new Set(),
    autoLinks: [],       // links computed from tags, flat list
    autoTutorials: [],   // tutorials computed from tags, flat list
    manualLinks: [],     // links added by hand for this session
    included: {},        // 'link:<id>' | 'tutorial:<id>' -> bool (defaults to true)
    fontspectorChecks: [], // FATAL/FAIL/WARN results: { key, status, id, title, filename, message, included, comment }
    fontspectorCounts: null, // counts per severity, across the whole report
    fontspectorMeta: null,   // { source: 'engine'|'paste', version, profile, files }
    screenshots: [],      // { id, dataUrl, filename, comment, problem (linked problem id or null) }
    linksComputedFor: null, // selection the links/tutorials of step 2 were computed for
    lastOutput: null        // last generated { markdown, link, payload, … }
  };

  let manualIdCounter = 1;
  let screenshotIdCounter = 1;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const [problems, linksDb, tutorialsDb] = await Promise.all([
        fetchJSON('data/problems.json'),
        fetchJSON('data/links-database.json'),
        fetchJSON('data/tutorials.json').catch(() => [])
      ]);
      state.problems = problems;
      state.linksDb = linksDb;
      state.tutorialsDb = tutorialsDb;
    } catch (err) {
      showToast('Error loading data — ' + err.message);
      console.error(err);
      return;
    }
    renderProblems();
    bindStaticEvents();
    await restoreFromLink();
  }

  function fetchJSON(path) {
    return fetch(path).then((res) => {
      if (!res.ok) throw new Error(path + ' not found (HTTP ' + res.status + ')');
      return res.json();
    });
  }

  function includedKey(kind, id) { return kind + ':' + id; }

  function slugifyCategory(cat) {
    return String(cat)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function slugify(str) {
    const s = String(str)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    return s || 'link';
  }

  /* ------------------------------ Step 1: problems ------------------------------ */
  /* All problem cards render into a single mixed grid — cards from different
     categories sit side by side, distinguished only by a pale category tint
     (see .cat-* classes in css/style.css) rather than by grouped sections. */

  function renderProblems() {
    const container = document.getElementById('problems-list');
    container.innerHTML = '';
    state.problems.forEach((problem) => container.appendChild(renderProblemCard(problem)));
  }

  function renderProblemCard(problem) {
    const label = document.createElement('label');
    label.className = 'problem-card cat-' + slugifyCategory(problem.category);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = problem.id;
    checkbox.checked = state.selectedProblemIds.has(problem.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedProblemIds.add(problem.id);
      else state.selectedProblemIds.delete(problem.id);
      refreshScreenshotIssueSelects();
    });

    const body = document.createElement('div');
    body.className = 'problem-card__body';

    const cat = document.createElement('span');
    cat.className = 'problem-card__category';
    cat.textContent = problem.category;
    body.appendChild(cat);

    const lbl = document.createElement('span');
    lbl.className = 'problem-card__label';
    lbl.textContent = problem.label;
    body.appendChild(lbl);

    if (problem.description) {
      const desc = document.createElement('p');
      desc.className = 'problem-card__desc';
      desc.textContent = problem.description;
      body.appendChild(desc);
    }

    if ((problem.tags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      problem.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    label.appendChild(checkbox);
    label.appendChild(body);
    return label;
  }

  /* -------------------------- Step 2: links & tutorials -------------------------- */

  function computeAutoLinks() {
    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const matches = [];
    state.linksDb.forEach((link) => {
      const matchedProblemIds = selected
        .filter((p) => (link.tags || []).some((t) => (p.tags || []).includes(t)))
        .map((p) => p.id);
      if (matchedProblemIds.length) {
        matches.push(Object.assign({}, link, { matchedProblemIds: matchedProblemIds }));
      }
    });
    return matches;
  }

  function computeAutoTutorials() {
    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const matches = [];
    state.tutorialsDb.forEach((tut) => {
      const matchedProblemIds = selected
        .filter((p) => (tut.tags || []).some((t) => (p.tags || []).includes(t)))
        .map((p) => p.id);
      if (matchedProblemIds.length) {
        matches.push(Object.assign({}, tut, { matchedProblemIds: matchedProblemIds }));
      }
    });
    return matches;
  }

  function selectionKey() {
    return Array.from(state.selectedProblemIds).sort().join('|');
  }

  function onShowLinks() {
    if (!state.selectedProblemIds.size) {
      showToast('Check at least one problem before showing links.');
      return;
    }
    refreshLinks();
  }

  // Recomputes the links and tutorials matching the selected problems.
  // Inclusion choices already made (unticked links…) are kept.
  function refreshLinks() {
    state.linksComputedFor = selectionKey();
    state.autoLinks = computeAutoLinks();
    state.autoTutorials = computeAutoTutorials();
    state.autoLinks.forEach((l) => {
      const k = includedKey('link', l.id);
      if (!(k in state.included)) state.included[k] = true;
    });
    state.autoTutorials.forEach((t) => {
      const k = includedKey('tutorial', t.id);
      if (!(k in state.included)) state.included[k] = true;
    });
    renderLinks();
  }

  function renderLinks() {
    const container = document.getElementById('links-groups');
    const emptyHint = document.getElementById('links-empty-hint');
    container.innerHTML = '';

    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    let anyRendered = false;

    selected.forEach((problem) => {
      const tutorialsForProblem = state.autoTutorials.filter((t) => t.matchedProblemIds.includes(problem.id));
      const linksForProblem = state.autoLinks.filter((l) => l.matchedProblemIds.includes(problem.id));
      if (!tutorialsForProblem.length && !linksForProblem.length) return;
      anyRendered = true;
      container.appendChild(renderProblemGroup(problem.label, tutorialsForProblem, linksForProblem, false));
    });

    if (state.manualLinks.length) {
      anyRendered = true;
      container.appendChild(renderProblemGroup('Added manually', [], state.manualLinks, true));
    }
    markStale();

    if (anyRendered) {
      emptyHint.style.display = 'none';
    } else {
      emptyHint.style.display = 'block';
      emptyHint.textContent = (state.autoLinks.length === 0 && state.autoTutorials.length === 0 && state.selectedProblemIds.size)
        ? "Nothing in the database matches this selection yet — add a link manually below, or fill out data/links-database.json / data/tutorials.json."
        : 'Check at least one problem in step 1, then click "Show links".';
    }
  }

  function renderProblemGroup(heading, tutorials, links, isManualGroup) {
    const wrap = document.createElement('div');
    wrap.className = 'link-group';

    const h = document.createElement('p');
    h.className = 'problem-group__title';
    h.textContent = heading;
    wrap.appendChild(h);

    if (tutorials.length) {
      const tutorialList = document.createElement('div');
      tutorialList.className = 'tutorial-list';
      tutorials.forEach((t) => tutorialList.appendChild(renderTutorialRow(t)));
      wrap.appendChild(tutorialList);
    }

    if (links.length) {
      const grid = document.createElement('div');
      grid.className = 'link-group__grid';
      links.forEach((link) => grid.appendChild(renderLinkRow(link, isManualGroup)));
      wrap.appendChild(grid);
    }

    return wrap;
  }

  function renderTutorialRow(tut) {
    const row = document.createElement('div');
    row.className = 'tutorial-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.included[includedKey('tutorial', tut.id)] !== false;
    checkbox.dataset.tutorialId = tut.id;
    checkbox.addEventListener('change', () => {
      const k = includedKey('tutorial', tut.id);
      state.included[k] = checkbox.checked;
      document.querySelectorAll('input[data-tutorial-id="' + CSS.escape(tut.id) + '"]').forEach((el) => {
        el.checked = checkbox.checked;
      });
    });

    const body = document.createElement('div');
    body.className = 'tutorial-row__body';

    const head = document.createElement('div');
    head.className = 'tutorial-row__head';
    const badge = document.createElement('span');
    badge.className = 'tutorial-badge';
    badge.textContent = 'Tutorial';
    head.appendChild(badge);
    const titleEl = document.createElement('p');
    titleEl.className = 'tutorial-row__title';
    titleEl.textContent = tut.title;
    head.appendChild(titleEl);
    body.appendChild(head);

    if (tut.description) {
      const desc = document.createElement('p');
      desc.className = 'tutorial-row__desc';
      desc.textContent = tut.description;
      body.appendChild(desc);
    }

    const note = document.createElement('p');
    note.className = 'tutorial-row__note';
    note.textContent = 'Included in full, with formatting, in the full report.';
    body.appendChild(note);

    if ((tut.tags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      tut.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    row.appendChild(checkbox);
    row.appendChild(body);
    return row;
  }

  function renderLinkRow(link, isManual) {
    const row = document.createElement('div');
    row.className = 'link-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.included[includedKey('link', link.id)] !== false;
    checkbox.dataset.linkId = link.id;
    checkbox.addEventListener('change', () => {
      const k = includedKey('link', link.id);
      state.included[k] = checkbox.checked;
      document.querySelectorAll('input[data-link-id="' + CSS.escape(link.id) + '"]').forEach((el) => {
        el.checked = checkbox.checked;
      });
    });

    const body = document.createElement('div');
    body.className = 'link-row__body';

    const titleEl = document.createElement('p');
    titleEl.className = 'link-row__title';
    titleEl.textContent = link.title;
    if (isManual) {
      const badge = document.createElement('span');
      badge.className = 'link-row__manual-badge';
      badge.textContent = 'manual';
      titleEl.appendChild(badge);
    }
    body.appendChild(titleEl);

    const urlEl = document.createElement('a');
    urlEl.className = 'link-row__url';
    urlEl.href = link.url;
    urlEl.target = '_blank';
    urlEl.rel = 'noopener';
    urlEl.textContent = link.url;
    body.appendChild(urlEl);

    if (link.explanation) {
      const exp = document.createElement('p');
      exp.className = 'link-row__explain';
      exp.textContent = link.explanation;
      body.appendChild(exp);
    }

    if ((link.tags || []).length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      link.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    row.appendChild(checkbox);
    row.appendChild(body);

    if (isManual) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn--danger-ghost link-row__remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.manualLinks = state.manualLinks.filter((l) => l.id !== link.id);
        delete state.included[includedKey('link', link.id)];
        renderLinks();
      });
      row.appendChild(removeBtn);
    }

    return row;
  }

  function onAddManualLink() {
    const titleInput = document.getElementById('ml-title');
    const urlInput = document.getElementById('ml-url');
    const explainInput = document.getElementById('ml-explain');
    const tagsInput = document.getElementById('ml-tags');

    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    const explanation = explainInput.value.trim();
    const tagsRaw = tagsInput.value.trim();

    if (!title || !url) {
      showToast('A title and a URL are required.');
      return;
    }

    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const id = 'manual-' + (manualIdCounter++);
    const link = { id: id, title: title, url: url, explanation: explanation, tags: tags };

    state.manualLinks.push(link);
    state.included[includedKey('link', id)] = true;

    titleInput.value = '';
    urlInput.value = '';
    explainInput.value = '';
    tagsInput.value = '';

    renderLinks();
    showManualLinkJsonHint(link);
  }

  function showManualLinkJsonHint(link) {
    const box = document.getElementById('manual-link-json');
    const pre = document.getElementById('manual-link-json-pre');
    const entry = {
      id: slugify(link.title),
      title: link.title,
      url: link.url,
      tags: link.tags,
      explanation: link.explanation
    };
    pre.textContent = JSON.stringify(entry, null, 2) + ',';
    box.classList.add('is-visible');
  }

  /* ---------------------------- Step 3: fontspector report ------------------------ */
  /* Main path: the user drops font files, and Fontspector itself (compiled to
     WebAssembly, vendored in vendor/fontspector/) runs the Google Fonts
     profile on them in a Web Worker — see js/fontspector-worker.js.
     Fallback path: paste a report produced elsewhere; Fontspector.parseReport()
     reads JSON, markdown or plain text. Either way, only FATAL/FAIL/WARN
     results are offered as checkboxes, unchecked by default — this is for
     picking a short priority list, not reproducing the whole report. */

  const CHECKABLE_STATUSES = ['FATAL', 'FAIL', 'WARN'];
  const CHECKABLE_STATUS_LABEL = { FATAL: 'FATAL — critical', FAIL: 'FAIL — to fix', WARN: 'WARN — to review' };
  const FONT_EXTENSIONS = /\.(ttf|otf)$/i;

  // One worker for the whole session: the engine loads once (a few MB),
  // then every later drop reuses it. Each run carries an id that the worker
  // echoes back, so a second drop while a check is still running can never
  // have its results mixed up with the first one's.
  const fsEngine = { worker: null, ready: false, run: null, nextRunId: 1 };

  function setFontspectorStatus(text, kind) {
    const el = document.getElementById('fontspector-status');
    el.textContent = text || '';
    el.className = 'fontspector-status' + (kind ? ' fontspector-status--' + kind : '');
  }

  function ensureFontspectorWorker() {
    if (fsEngine.worker) return fsEngine.worker;
    if (typeof Worker === 'undefined') throw new Error('this browser does not support Web Workers');
    const worker = new Worker('js/fontspector-worker.js', { type: 'module' });
    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'ready') {
        fsEngine.ready = true;
        if (fsEngine.run) fsEngine.run.onReady();
        return;
      }
      const run = fsEngine.run;
      if (!run) return;
      if (msg.runId !== undefined && msg.runId !== run.id) return; // stale result from a superseded run
      if (msg.type === 'result') run.onResult(msg);
      else if (msg.type === 'error') run.onError(msg.error);
    };
    worker.onerror = (event) => {
      // Fires when the worker script or the engine files can't load at all.
      if (event && event.preventDefault) event.preventDefault();
      worker.terminate();
      fsEngine.worker = null;
      fsEngine.ready = false;
      const run = fsEngine.run;
      if (run) run.onError((event && event.message) || 'the engine files did not load', true);
    };
    fsEngine.worker = worker;
    return worker;
  }

  function readFileAsBytes(file) {
    if (file.arrayBuffer) return file.arrayBuffer().then((buf) => new Uint8Array(buf));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  function describeFiles(names) {
    return names.length === 1 ? names[0] : names.length + ' fonts';
  }

  function openPasteFallback() {
    const details = document.getElementById('fontspector-paste-details');
    if (details) details.open = true;
  }

  async function onFontFiles(fileList) {
    const all = Array.from(fileList || []);
    const fonts = all.filter((f) => FONT_EXTENSIONS.test(f.name));
    const skipped = all.length - fonts.length;
    if (!fonts.length) {
      showToast('Drop .ttf or .otf font files.');
      return;
    }
    if (skipped) showToast(skipped + (skipped === 1 ? ' file was' : ' files were') + ' not a .ttf/.otf font and got skipped.');

    const names = fonts.map((f) => f.name);
    const files = {};
    try {
      const bytes = await Promise.all(fonts.map(readFileAsBytes));
      fonts.forEach((f, i) => { files[f.name] = bytes[i]; });
    } catch (err) {
      setFontspectorStatus("Couldn't read the font file(s): " + err.message, 'error');
      return;
    }

    let worker;
    try {
      worker = ensureFontspectorWorker();
    } catch (err) {
      setFontspectorStatus("Fontspector can't run here (" + err.message + '). Paste a report instead, below.', 'error');
      openPasteFallback();
      return;
    }

    const run = { id: fsEngine.nextRunId++, names: names, started: Date.now(), phase: fsEngine.ready ? 'checking' : 'loading', ticker: null };
    fsEngine.run = run;

    function refresh() {
      if (fsEngine.run !== run) return;
      const secs = Math.round((Date.now() - run.started) / 1000);
      if (run.phase === 'loading') {
        setFontspectorStatus('Loading Fontspector… (a few MB the first time, cached afterwards) ' + secs + 's', 'busy');
      } else {
        setFontspectorStatus('Checking ' + describeFiles(names) + ' with the Google Fonts profile… ' + secs + 's', 'busy');
      }
    }
    function stop() { clearInterval(run.ticker); }

    run.onReady = () => { run.phase = 'checking'; refresh(); };
    run.onResult = (msg) => { stop(); fsEngine.run = null; onFontspectorEngineResults(msg, names); };
    run.onError = (error, couldNotLoad) => {
      stop();
      fsEngine.run = null;
      console.error('Fontspector:', error);
      setFontspectorStatus(
        couldNotLoad
          ? "Fontspector couldn't start (" + error + '). If you opened index.html straight from disk, serve the folder over http instead (see the README) — or paste a report below.'
          : 'Fontspector stopped with an error: ' + error + ' — you can still paste a report below.',
        'error'
      );
      openPasteFallback();
    };

    run.ticker = setInterval(refresh, 1000);
    refresh();
    worker.postMessage({ type: 'run', runId: run.id, profile: 'googlefonts', files: files });
  }

  function onFontspectorEngineResults(msg, names) {
    const parsed = Fontspector.fromCheckResults(msg.results);
    const relevant = parsed.checks.filter((c) => CHECKABLE_STATUSES.includes(c.status));
    state.fontspectorChecks = relevant.map((c, i) => ({
      key: 'fs-' + i,
      status: c.status,
      id: c.id,
      title: c.title,
      filename: names.length > 1 ? c.filename : null,
      message: c.message,
      included: false,
      comment: ''
    }));
    state.fontspectorCounts = parsed.counts;
    state.fontspectorMeta = {
      source: 'engine',
      version: msg.version,
      profile: 'googlefonts',
      files: names
    };

    // The engine reads the family name from the font itself — use it as the
    // project name, unless one was already typed in.
    const projectField = document.getElementById('meta-project');
    if (msg.familyName && projectField && !projectField.value.trim()) {
      projectField.value = msg.familyName;
    }

    setFontspectorStatus(
      'Checked ' + describeFiles(names) + ' — Fontspector ' + msg.version + ', Google Fonts profile.' +
      (relevant.length ? ' Tick what matters below.' : ' No FAIL, WARN or FATAL: nothing to prioritize.'),
      'done'
    );
    renderFontspectorChecks();
  }

  function onParseFontspectorReport() {
    const raw = document.getElementById('fontspector-paste').value.trim();
    if (!raw) {
      showToast('Paste a Fontspector report first — JSON, markdown, or plain text all work.');
      return;
    }

    let parsed;
    try {
      parsed = Fontspector.parseReport(raw);
    } catch (err) {
      console.error(err);
      showToast('Could not read this report — see the console.');
      return;
    }

    const relevant = parsed.checks.filter((c) => CHECKABLE_STATUSES.includes(c.status));
    state.fontspectorChecks = relevant.map((c, i) => ({
      key: 'fs-' + i,
      status: c.status,
      id: c.id,
      title: '',
      filename: null,
      message: c.message,
      included: false,
      comment: ''
    }));
    state.fontspectorCounts = parsed.counts;
    state.fontspectorMeta = { source: 'paste' };

    if (parsed.looksLikeSummaryOnly) {
      showToast("That looks like just the summary counts table — scroll to the individual check results below it in your report (each with its own ID and message) and paste those instead.");
    } else if (!parsed.checks.length) {
      showToast("Couldn't find any check results in this — paste more of the report, or see js/fontspector.js if the format looks right to you.");
    } else if (!relevant.length) {
      showToast('No FAIL, WARN, or FATAL in this report — nothing to prioritize.');
    }

    renderFontspectorChecks();
  }

  function renderFontspectorChecks() {
    const summaryBox = document.getElementById('fontspector-summary');
    const summaryTitle = document.getElementById('fontspector-summary-title');
    const summaryCounts = document.getElementById('fontspector-summary-counts');
    const list = document.getElementById('fontspector-checks');
    list.innerHTML = '';

    if (!state.fontspectorCounts) {
      summaryBox.classList.remove('is-visible');
      return;
    }

    const total = Object.values(state.fontspectorCounts).reduce((a, b) => a + b, 0);
    summaryTitle.textContent = total
      ? total + ' results found'
      : "Parsed, but no results were recognized in this text.";

    summaryCounts.innerHTML = '';
    Fontspector.STATUS_ORDER.forEach((status) => {
      const n = state.fontspectorCounts[status];
      if (!n) return;
      const el = document.createElement('span');
      el.className = 'status-count';
      el.innerHTML = '<span class="status-dot status-dot--' + status.toLowerCase() + '"></span>' + n + ' ' + status;
      summaryCounts.appendChild(el);
    });
    summaryBox.classList.add('is-visible');

    CHECKABLE_STATUSES.forEach((status) => {
      const items = state.fontspectorChecks.filter((c) => c.status === status);
      if (!items.length) return;
      const heading = document.createElement('p');
      heading.className = 'problem-group__title';
      heading.textContent = CHECKABLE_STATUS_LABEL[status] + ' (' + items.length + ')';
      list.appendChild(heading);
      items.forEach((check) => list.appendChild(renderFontspectorCheckRow(check)));
    });
  }

  // Little header inside every comment bubble (Fontspector checks and
  // screenshots), so a comment reads the same here as in the report.
  function commentBubbleLabel() {
    const label = document.createElement('span');
    label.className = 'comment-bubble__label';
    label.textContent = 'Comment';
    return label;
  }

  function renderFontspectorCheckRow(check) {
    const row = document.createElement('label');
    row.className = 'check-row check-row--' + check.status.toLowerCase();

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = check.included;
    checkbox.addEventListener('change', () => { check.included = checkbox.checked; });

    const body = document.createElement('div');
    body.className = 'check-row__body';

    const head = document.createElement('div');
    head.className = 'check-row__head';
    const badge = document.createElement('span');
    badge.className = 'check-badge check-badge--' + check.status.toLowerCase();
    badge.textContent = check.status;
    head.appendChild(badge);
    const idEl = document.createElement('span');
    idEl.className = 'check-row__id';
    idEl.textContent = check.id + (check.filename ? '  ·  ' + check.filename : '');
    head.appendChild(idEl);

    const commentToggle = document.createElement('button');
    commentToggle.type = 'button';
    commentToggle.className = 'btn btn--ghost check-row__comment-toggle';
    head.appendChild(commentToggle);

    body.appendChild(head);

    if (check.title) {
      const titleEl = document.createElement('p');
      titleEl.className = 'check-row__title';
      titleEl.textContent = check.title;
      body.appendChild(titleEl);
    }

    if (check.message) {
      const msg = document.createElement('p');
      msg.className = 'check-row__message';
      msg.textContent = check.message;
      body.appendChild(msg);

      // Long messages (lists of glyphs, tables…) are clamped to a few lines,
      // with a toggle to read the rest — without touching the checkbox.
      if (check.message.length > 260 || check.message.split('\n').length > 4) {
        msg.classList.add('is-clamped');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'check-row__more';
        more.textContent = 'Show full message';
        more.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const clamped = msg.classList.toggle('is-clamped');
          more.textContent = clamped ? 'Show full message' : 'Show less';
        });
        body.appendChild(more);
      }
    }

    // Hidden by default — the button below reveals it. Clicks inside this
    // whole block stop propagation so typing a comment (or just opening the
    // field) never accidentally toggles the row's own include checkbox,
    // since the row itself is a clickable <label>.
    const commentWrap = document.createElement('div');
    commentWrap.className = 'check-row__comment-field comment-bubble';
    commentWrap.addEventListener('click', (e) => e.stopPropagation());
    commentWrap.appendChild(commentBubbleLabel());

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Add a note for this check — appears in the comment and the report, right under it. Markdown works.';
    textarea.value = check.comment || '';
    commentWrap.appendChild(textarea);
    body.appendChild(commentWrap);

    function updateToggleLabel() {
      commentToggle.textContent = textarea.value.trim() ? 'Comment ✓' : 'Comment';
    }
    updateToggleLabel();
    if (check.comment) commentWrap.classList.add('is-visible');

    textarea.addEventListener('input', () => {
      check.comment = textarea.value;
      updateToggleLabel();
    });

    commentToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nowVisible = commentWrap.classList.toggle('is-visible');
      if (nowVisible) textarea.focus();
    });

    row.appendChild(checkbox);
    row.appendChild(body);
    return row;
  }

  /* ------------------------------- Step 4: screenshots ---------------------------- */

  // Files are read in parallel but added in the order they were picked.
  async function onScreenshotFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => {
      if (file.type && file.type.indexOf('image/') === 0) return true;
      showToast(file.name + ' is not an image — skipped.');
      return false;
    });
    const read = (file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => { showToast("Couldn't read " + file.name + '.'); resolve(null); };
      reader.readAsDataURL(file);
    });
    const urls = await Promise.all(files.map(read));
    files.forEach((file, i) => {
      if (!urls[i]) return;
      state.screenshots.push({
        id: 'shot-' + (screenshotIdCounter++),
        dataUrl: urls[i],
        filename: file.name,
        comment: '',
        problem: null
      });
    });
    if (files.length) renderScreenshots();
  }

  function renderScreenshots() {
    const container = document.getElementById('screenshots-list');
    const emptyHint = document.getElementById('screenshots-empty-hint');
    container.innerHTML = '';
    state.screenshots.forEach((shot) => container.appendChild(renderScreenshotCard(shot)));
    emptyHint.style.display = state.screenshots.length ? 'none' : 'block';
    markStale();
  }

  // Options = the problems checked in step 1. A screenshot linked to a
  // problem that gets unchecked shows "not linked" (and is treated so),
  // but remembers its link in case the problem is checked again.
  function fillIssueSelect(select, shot) {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = state.selectedProblemIds.size ? '— Not linked to an issue' : '— Check problems in step 1 first';
    select.appendChild(none);
    state.problems.filter((p) => state.selectedProblemIds.has(p.id)).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      select.appendChild(opt);
    });
    select.value = shot.problem && state.selectedProblemIds.has(shot.problem) ? shot.problem : '';
    select.disabled = !state.selectedProblemIds.size;
  }

  function refreshScreenshotIssueSelects() {
    document.querySelectorAll('#screenshots-list select[data-shot-id]').forEach((select) => {
      const shot = state.screenshots.find((s) => s.id === select.dataset.shotId);
      if (shot) fillIssueSelect(select, shot);
    });
  }

  function renderScreenshotCard(shot) {
    const card = document.createElement('div');
    card.className = 'screenshot-card';

    const img = document.createElement('img');
    img.src = shot.dataUrl;
    img.alt = shot.filename;
    img.className = 'screenshot-card__img';
    card.appendChild(img);

    const body = document.createElement('div');
    body.className = 'screenshot-card__body';

    const name = document.createElement('p');
    name.className = 'screenshot-card__filename';
    name.textContent = shot.filename;
    body.appendChild(name);

    // Which checked problem this screenshot illustrates: the GitHub checklist
    // then says "(see the screenshots in the full report)" on that item.
    const issueField = document.createElement('label');
    issueField.className = 'screenshot-card__issue';
    const issueLabel = document.createElement('span');
    issueLabel.textContent = 'Linked issue';
    issueField.appendChild(issueLabel);
    const select = document.createElement('select');
    select.dataset.shotId = shot.id;
    select.addEventListener('change', () => { shot.problem = select.value || null; });
    fillIssueSelect(select, shot);
    issueField.appendChild(select);
    body.appendChild(issueField);

    const bubble = document.createElement('div');
    bubble.className = 'comment-bubble';
    bubble.appendChild(commentBubbleLabel());
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Comment on this screenshot — appears in the comment and the report, right under the image.';
    textarea.value = shot.comment;
    textarea.dataset.shotId = shot.id;
    textarea.addEventListener('input', () => { shot.comment = textarea.value; });
    bubble.appendChild(textarea);
    body.appendChild(bubble);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn--danger-ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.screenshots = state.screenshots.filter((s) => s.id !== shot.id);
      renderScreenshots();
    });
    body.appendChild(removeBtn);

    card.appendChild(body);
    return card;
  }

  /* --------------------------------- Step 5: generate ----------------------------- */
  /* Builds the "report" object (format described at the top of
     js/github-comment.js), stores it in a link (js/urlhosted.js) and writes
     the Markdown checklist around that link. GitHub refuses comments over
     65,536 characters, link included, so screenshots are re-encoded smaller
     and smaller until the whole comment fits (see fitToComment). */

  // Tried in order until the comment fits. maxSide = longest image side, in px.
  const IMAGE_LEVELS = [
    { maxSide: 1600, quality: 0.82 },
    { maxSide: 1400, quality: 0.78 },
    { maxSide: 1200, quality: 0.74 },
    { maxSide: 1024, quality: 0.7 },
    { maxSide: 900, quality: 0.64 },
    { maxSide: 800, quality: 0.58 },
    { maxSide: 700, quality: 0.52 },
    { maxSide: 600, quality: 0.48 },
    { maxSide: 520, quality: 0.44 },
    { maxSide: 440, quality: 0.4 }
  ];

  const imageCache = new Map(); // `${shot.id}:${level}` -> data URL
  let webpSupport = null;

  function canEncodeWebp() {
    if (webpSupport === null) {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      webpSupport = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    }
    return webpSupport;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not decode the image'));
      img.src = src;
    });
  }

  async function compressShot(shot, levelIndex) {
    const key = shot.id + ':' + levelIndex;
    if (imageCache.has(key)) return imageCache.get(key);
    const level = IMAGE_LEVELS[levelIndex];
    let out;
    try {
      const img = await loadImage(shot.dataUrl);
      const w = img.naturalWidth;
      const hgt = img.naturalHeight;
      const scale = Math.min(1, level.maxSide / Math.max(w, hgt));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(hgt * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; // screenshots don't need transparency, and JPEG has none
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      out = canvas.toDataURL(canEncodeWebp() ? 'image/webp' : 'image/jpeg', level.quality);
      // a small original (an icon, a tight crop) may already be lighter
      if (scale === 1 && /^data:image\/(png|jpeg|webp|gif);base64,/.test(shot.dataUrl) && shot.dataUrl.length <= out.length) out = shot.dataUrl;
    } catch (err) {
      console.error('Screenshot ' + shot.filename + ':', err);
      out = '';
    }
    imageCache.set(key, out);
    return out;
  }

  function fieldValue(id) {
    return document.getElementById(id).value.trim();
  }

  async function buildReport() {
    if (state.selectedProblemIds.size && state.linksComputedFor !== selectionKey()) refreshLinks();

    const selected = state.problems.filter((p) => state.selectedProblemIds.has(p.id));
    const isIncluded = (kind, id) => state.included[includedKey(kind, id)] !== false;

    const tutorials = [];
    for (const tut of state.autoTutorials.filter((t) => isIncluded('tutorial', t.id))) {
      try {
        const res = await fetch(tut.path);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        tutorials.push({ id: tut.id, title: tut.title, markdown: await res.text() });
      } catch (err) {
        console.error('Could not load tutorial ' + tut.path, err);
        showToast('Could not load "' + tut.title + '" (' + tut.path + ') — skipped.');
      }
    }
    const loadedTutorials = new Set(tutorials.map((t) => t.id));

    const problems = selected.map((problem) => ({
      id: problem.id,
      label: problem.label,
      action: problem.action || '',
      category: problem.category,
      tutorials: state.autoTutorials
        .filter((t) => t.matchedProblemIds.includes(problem.id) && loadedTutorials.has(t.id))
        .map((t) => t.id),
      links: state.autoLinks
        .filter((l) => l.matchedProblemIds.includes(problem.id) && isIncluded('link', l.id))
        .map((l) => ({ id: l.id, title: l.title, url: l.url, explanation: l.explanation || '' }))
    }));

    const manual = state.manualLinks.filter((l) => isIncluded('link', l.id));
    if (manual.length) {
      problems.push({
        id: null,
        manual: true,
        label: 'Additional resources',
        category: '',
        tutorials: [],
        links: manual.map((l) => ({ id: null, title: l.title, url: l.url, explanation: l.explanation || '' }))
      });
    }

    const picked = state.fontspectorChecks.filter((c) => c.included);
    const meta = state.fontspectorMeta || {};
    const fontspector = picked.length ? {
      source: meta.source || null,
      version: meta.version || null,
      profile: meta.profile || null,
      files: meta.files || [],
      counts: state.fontspectorCounts || null,
      checks: picked.map((c) => ({
        status: c.status,
        id: c.id,
        title: c.title || '',
        filename: c.filename || null,
        message: c.message || '',
        comment: (c.comment || '').trim()
      }))
    } : null;

    return {
      app: 'typo-guide-generator',
      v: 1,
      title: fieldValue('meta-title') || 'Typography review',
      author: fieldValue('meta-reviewer-name'),   // urlHosted's name for it
      date: new Date().toISOString(),            // urlHosted keeps one too
      project: fieldValue('meta-project'),
      designer: fieldValue('meta-designer'),
      notes: fieldValue('meta-notes'),
      contact: fieldValue('meta-reviewer-contact'),
      problems: problems,
      tutorials: tutorials,
      fontspector: fontspector,
      screenshots: []
    };
  }

  async function fitToComment(report) {
    const publicBase = TypoConfig.publicBaseUrl();
    const reportPage = publicBase + 'report.html';
    const budget = TypoConfig.COMMENT_BUDGET;
    const shots = state.screenshots;

    async function attempt(images) {
      const r = Object.assign({}, report, { screenshots: images });
      const payload = await UrlHosted.serialize(r);
      const link = UrlHosted.makeLink(reportPage, payload);
      const markdown = GitHubComment.build(r, { reportUrl: link, baseUrl: publicBase });
      return { report: r, payload: payload, link: link, markdown: markdown, length: markdown.length, level: null, omitted: 0, fits: markdown.length <= budget };
    }
    const linked = (shot) => (shot.problem && state.selectedProblemIds.has(shot.problem) ? shot.problem : null);
    const base = (src, i, extra) => Object.assign({ name: shots[i].filename, comment: (shots[i].comment || '').trim(), problem: linked(shots[i]), src: src }, extra || {});

    if (!shots.length) return attempt([]);

    // Size of everything but the images, to skip levels that can't fit.
    const bare = await attempt(shots.map((s, i) => base('', i)));
    const last = IMAGE_LEVELS.length - 1;
    for (let li = 0; li <= last; li++) {
      const srcs = await Promise.all(shots.map((s) => compressShot(s, li)));
      const estimate = bare.length + srcs.reduce((n, src) => n + src.length, 0);
      if (estimate > budget * 1.03 && li < last) continue;
      const res = await attempt(srcs.map((src, i) => base(src, i)));
      if (res.fits) return Object.assign(res, { level: IMAGE_LEVELS[li], levelIndex: li });
    }

    // Still too long at the lowest quality: leave the heaviest images out of
    // the link — the comment then asks to attach those on GitHub directly.
    const srcs = await Promise.all(shots.map((s) => compressShot(s, last)));
    const order = srcs.map((src, i) => i).sort((a, b) => srcs[b].length - srcs[a].length);
    const omitted = new Set();
    let res = null;
    for (const idx of order) {
      omitted.add(idx);
      res = await attempt(srcs.map((src, i) => (omitted.has(i) ? base('', i, { omitted: true }) : base(src, i))));
      if (res.fits) break;
    }
    return Object.assign(res, { level: IMAGE_LEVELS[last], levelIndex: last, omitted: omitted.size });
  }

  async function onGenerate() {
    const hasProblem = state.selectedProblemIds.size > 0;
    const hasManual = state.manualLinks.some((l) => state.included[includedKey('link', l.id)] !== false);
    const hasFontspectorSelection = state.fontspectorChecks.some((c) => c.included);
    if (!hasProblem && !hasManual && !state.screenshots.length && !hasFontspectorSelection) {
      showToast('Select a problem, tick a Fontspector check, or add a screenshot before generating.');
      return;
    }
    if (!UrlHosted.supported()) {
      showToast('This browser is too old to build the report link — use a recent Chrome, Firefox, Edge or Safari.');
      return;
    }

    const btn = document.getElementById('btn-generate');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = state.screenshots.length ? 'Generating… (compressing screenshots)' : 'Generating…';

    try {
      const report = await buildReport();
      const result = await fitToComment(report);
      state.lastOutput = result;
      renderOutput(result);
    } catch (err) {
      console.error(err);
      showToast('Error while generating the comment — ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function formatNumber(n) { return Number(n).toLocaleString('en-US'); }

  // The comment on screen no longer matches the form.
  function markStale() {
    if (state.lastOutput) document.getElementById('output-stale').hidden = false;
  }

  function renderOutput(result) {
    const panel = document.getElementById('output-panel');
    panel.hidden = false;
    document.getElementById('output-stale').hidden = true;

    document.getElementById('comment-markdown').value = result.markdown;
    document.getElementById('output-edited').hidden = true;
    renderCommentPreview();
    updateMeter();

    const notes = [];
    if (result.level && !result.omitted) {
      notes.push({ kind: 'info', text: 'Screenshots are stored in the link at up to ' + result.level.maxSide + ' px, quality ' + Math.round(result.level.quality * 100) + ' %, so the comment fits on GitHub.' });
    }
    if (result.omitted) {
      notes.push({ kind: 'warn', text: result.omitted + ' screenshot' + (result.omitted === 1 ? ' was' : 's were') + ' too heavy to fit in the link, even small: drag ' + (result.omitted === 1 ? 'it' : 'them') + ' into the GitHub comment yourself, after pasting (the comment marks which).' });
    }
    if (!result.fits) {
      notes.push({ kind: 'warn', text: 'This comment is longer than GitHub accepts. Untick a few Fontspector checks (their messages are long) and generate again.' });
    }
    if (TypoConfig.isLocal()) {
      notes.push({ kind: 'info', text: 'You are running the tool locally, so the links in the comment point to the published site (' + TypoConfig.PUBLIC_SITE_URL + '): push this version to GitHub first, so report.html exists there. “Open the full report” below uses your local copy.' });
    }
    const list = document.getElementById('output-notes');
    list.innerHTML = '';
    notes.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'output-note output-note--' + n.kind;
      li.textContent = n.text;
      list.appendChild(li);
    });

    document.getElementById('btn-open-report').href = UrlHosted.makeLink(TypoConfig.currentBaseUrl() + 'report.html', result.payload);

    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The comment as it will be copied: the generated Markdown, or the
  // reviewer's edits of it in the Markdown tab.
  function currentComment() {
    return document.getElementById('comment-markdown').value;
  }

  function renderCommentPreview() {
    const preview = document.getElementById('comment-preview');
    preview.innerHTML = '';
    preview.appendChild(Markdown.render(currentComment(), { breaks: true, linkTarget: '_blank' }));
  }

  function updateMeter() {
    if (!state.lastOutput) return;
    const length = currentComment().length;
    const limit = TypoConfig.GITHUB_COMMENT_LIMIT;
    const ratio = Math.min(1, length / limit);
    document.getElementById('size-meter-fill').style.width = (ratio * 100).toFixed(1) + '%';
    document.getElementById('size-meter').className = 'size-meter size-meter--' + (length <= TypoConfig.COMMENT_BUDGET ? 'ok' : 'over');
    document.getElementById('size-meter-text').textContent =
      formatNumber(length) + ' / ' + formatNumber(limit) + ' characters (GitHub’s limit for a comment) — the report link takes ' +
      formatNumber(state.lastOutput.link.length) + ' of them.';
  }

  function setOutputTab(which) {
    const isPreview = which === 'preview';
    const tabPreview = document.getElementById('tab-preview');
    const tabMarkdown = document.getElementById('tab-markdown');
    tabPreview.classList.toggle('is-active', isPreview);
    tabMarkdown.classList.toggle('is-active', !isPreview);
    tabPreview.setAttribute('aria-selected', String(isPreview));
    tabMarkdown.setAttribute('aria-selected', String(!isPreview));
    if (isPreview) renderCommentPreview();
    document.getElementById('comment-preview').hidden = !isPreview;
    document.getElementById('comment-markdown').hidden = isPreview;
    document.getElementById('output-edit-hint').hidden = isPreview;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ----------------------------- Opening a report link ---------------------------- */
  /* index.html#?<payload> — the "Edit in the generator" button of the report
     page — puts a report back into the form, ready to change and generate
     again. Like urlHosted, the old link is dropped from the address bar as
     soon as something changes, since it no longer matches what's on screen. */

  async function restoreFromLink() {
    const payload = UrlHosted.payloadFromHash(window.location.hash);
    if (!payload) return;
    let report;
    try {
      report = await UrlHosted.deserialize(payload);
    } catch (err) {
      console.error(err);
      showToast("The report in this link couldn't be read — it was probably cut off when copied.");
      return;
    }
    if (!report || report.app !== 'typo-guide-generator') return;

    const dropped = applyReport(report);
    showToast('Report loaded from the link — change anything, then generate again.' +
      (dropped ? ' (' + dropped + ')' : ''));

    const forget = () => {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      document.removeEventListener('input', forget, true);
      document.removeEventListener('change', forget, true);
    };
    document.addEventListener('input', forget, true);
    document.addEventListener('change', forget, true);
  }

  function applyReport(r) {
    const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
    const arr = (v) => (Array.isArray(v) ? v : []);
    const dropped = [];

    document.getElementById('meta-title').value = str(r.title) || 'Typography review';
    document.getElementById('meta-project').value = str(r.project);
    document.getElementById('meta-designer').value = str(r.designer);
    document.getElementById('meta-notes').value = str(r.notes);
    document.getElementById('meta-reviewer-name').value = str(r.author);
    document.getElementById('meta-reviewer-contact').value = str(r.contact);

    // Step 1 + 2: problems, then which of their links/tutorials were kept.
    const problems = arr(r.problems);
    const known = new Set(state.problems.map((p) => p.id));
    state.selectedProblemIds = new Set(problems.filter((p) => !p.manual && known.has(p.id)).map((p) => p.id));
    const unknown = problems.filter((p) => !p.manual && !known.has(p.id)).length;
    if (unknown) dropped.push(unknown + ' problem' + (unknown === 1 ? ' is' : 's are') + ' no longer in the list');
    renderProblems();

    if (state.selectedProblemIds.size) {
      state.autoLinks = computeAutoLinks();
      state.autoTutorials = computeAutoTutorials();
      state.linksComputedFor = selectionKey();
      const keptLinks = new Set();
      problems.forEach((p) => arr(p.links).forEach((l) => { if (l && l.id) keptLinks.add(l.id); }));
      const keptTutorials = new Set(arr(r.tutorials).map((t) => t && t.id));
      state.autoLinks.forEach((l) => { state.included[includedKey('link', l.id)] = keptLinks.has(l.id); });
      state.autoTutorials.forEach((t) => { state.included[includedKey('tutorial', t.id)] = keptTutorials.has(t.id); });
    }
    // Links added by hand, or gone from the database since: back as manual links.
    const autoIds = new Set(state.autoLinks.map((l) => l.id));
    const seen = new Set();
    problems.forEach((p) => arr(p.links).forEach((l) => {
      if (!l || !l.url) return;
      if (!p.manual && l.id && autoIds.has(l.id)) return;
      if (seen.has(l.url)) return;
      seen.add(l.url);
      const id = 'manual-' + (manualIdCounter++);
      state.manualLinks.push({ id: id, title: str(l.title) || str(l.url), url: str(l.url), explanation: str(l.explanation), tags: [] });
      state.included[includedKey('link', id)] = true;
    }));
    renderLinks();

    // Step 3: only the checks that were picked travel in the link.
    const fs = r.fontspector && typeof r.fontspector === 'object' ? r.fontspector : null;
    const checks = fs ? arr(fs.checks) : [];
    if (checks.length) {
      state.fontspectorChecks = checks.map((c, i) => ({
        key: 'fs-' + i,
        status: str(c.status).toUpperCase(),
        id: str(c.id),
        title: str(c.title),
        filename: c.filename ? str(c.filename) : null,
        message: str(c.message),
        included: true,
        comment: str(c.comment)
      }));
      const counts = {};
      if (fs.counts && typeof fs.counts === 'object') {
        Object.keys(fs.counts).forEach((k) => { if (typeof fs.counts[k] === 'number') counts[k] = fs.counts[k]; });
      } else {
        state.fontspectorChecks.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
      }
      state.fontspectorCounts = counts;
      state.fontspectorMeta = { source: str(fs.source) || 'link', version: str(fs.version), profile: str(fs.profile), files: arr(fs.files).map(str) };
      renderFontspectorChecks();
      setFontspectorStatus('Loaded from the link: the ' + checks.length + ' check' + (checks.length === 1 ? '' : 's') +
        ' picked for this report. Drop the fonts again to re-run Fontspector.', 'done');
    }

    // Step 4: screenshots come back at the quality they had in the link.
    const shots = arr(r.screenshots);
    state.screenshots = shots
      .filter((s) => s && !s.omitted && /^data:image\/(png|jpeg|webp|gif);base64,/.test(str(s.src)))
      .map((s) => ({ id: 'shot-' + (screenshotIdCounter++), dataUrl: str(s.src), filename: str(s.name) || 'screenshot', comment: str(s.comment), problem: s.problem ? str(s.problem) : null }));
    const missing = shots.length - state.screenshots.length;
    if (missing) dropped.push(missing + ' screenshot' + (missing === 1 ? ' was' : 's were') + ' not stored in the link');
    renderScreenshots();

    return dropped.join(', ');
  }

  /* ----------------------------------- Misc ---------------------------------------- */

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3600);
  }

  function bindStaticEvents() {
    // Any edit in steps 1–5 after generating makes the comment out of date.
    ['input', 'change'].forEach((type) => document.addEventListener(type, (e) => {
      if (!e.target.closest || e.target.closest('#output-panel')) return;
      if (e.target.closest('.section')) markStale();
    }));
    document.getElementById('btn-show-links').addEventListener('click', onShowLinks);
    document.getElementById('btn-add-manual-link').addEventListener('click', onAddManualLink);
    document.getElementById('btn-parse-fontspector').addEventListener('click', onParseFontspectorReport);

    const fontDropzone = document.getElementById('font-dropzone');
    const fontInput = document.getElementById('font-file-input');
    fontDropzone.addEventListener('click', () => fontInput.click());
    fontDropzone.addEventListener('dragover', (e) => { e.preventDefault(); fontDropzone.classList.add('is-dragover'); });
    fontDropzone.addEventListener('dragleave', () => fontDropzone.classList.remove('is-dragover'));
    fontDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      fontDropzone.classList.remove('is-dragover');
      onFontFiles(e.dataTransfer.files);
    });
    fontInput.addEventListener('click', (e) => e.stopPropagation());
    fontInput.addEventListener('change', () => {
      onFontFiles(fontInput.files);
      fontInput.value = '';
    });
    document.getElementById('btn-generate').addEventListener('click', onGenerate);
    document.getElementById('tab-preview').addEventListener('click', () => setOutputTab('preview'));
    document.getElementById('tab-markdown').addEventListener('click', () => setOutputTab('markdown'));
    document.getElementById('comment-markdown').addEventListener('input', () => {
      document.getElementById('output-edited').hidden = currentComment() === state.lastOutput.markdown;
      updateMeter();
    });
    document.getElementById('btn-copy-markdown').addEventListener('click', async () => {
      if (!state.lastOutput) return;
      const ok = await copyText(currentComment());
      showToast(ok ? 'Comment copied — paste it on the GitHub issue.' : "Couldn't copy — select the Markdown tab and copy by hand.");
    });
    document.getElementById('btn-copy-link').addEventListener('click', async () => {
      if (!state.lastOutput) return;
      const ok = await copyText(state.lastOutput.link);
      showToast(ok ? 'Report link copied.' : "Couldn't copy the link.");
    });

    const dropzone = document.getElementById('screenshot-dropzone');
    const fileInput = document.getElementById('screenshot-file-input');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
      onScreenshotFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => {
      onScreenshotFiles(fileInput.files);
      fileInput.value = '';
    });
  }
})();
