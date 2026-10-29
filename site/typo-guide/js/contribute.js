/* ==========================================================================
   Suggest links — additive only, no editing/removal of the live database.

   This page never writes anywhere by itself. "Copy links & open GitHub"
   copies the new entries to the clipboard and opens GitHub's real "edit
   this file" page for data/links-database.json in a new tab — the
   contributor pastes, then commits. If they don't have write access,
   GitHub forks the repo for them automatically and proposes their commit
   back as a pull request, showing a normal diff against the real file
   (no extra files, no separate proposal folder). The repo owner reviews
   and merges like any other PR.

   Why not fully automatic? Pre-filling the *diff* of an existing file via
   a plain URL isn't something GitHub supports (only brand-new files can
   be pre-filled that way) — doing this without a manual paste step would
   require a backend holding write credentials, which a static site
   can't safely have. One paste, in exchange for no secrets anywhere.
   ========================================================================== */

(function () {
  'use strict';

  // Update these if the repo is ever renamed or transferred.
  const REPO_OWNER = 'emmamarichal';
  const REPO_NAME = 'gf-issues-dashboard';
  const REPO_BRANCH = 'main';
  const SITE_DIR = 'site/typo-guide/'; // where this tool lives in the repo
  const DB_PATH = SITE_DIR + 'data/links-database.json';
  const TUTORIALS_DB_PATH = SITE_DIR + 'data/tutorials.json';

  let entries = [{ title: '', url: '', tags: '', explanation: '' }];
  let knownTags = [];

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const res = await fetch('data/problems.json');
      if (res.ok) {
        const problems = await res.json();
        const set = new Set();
        problems.forEach((p) => (p.tags || []).forEach((t) => set.add(t)));
        knownTags = Array.from(set).sort();
      }
    } catch (e) { /* purely a helper list — fine if it fails to load */ }

    renderKnownTags();
    render();
    bindEvents();
  }

  function renderKnownTags() {
    const el = document.getElementById('known-tags');
    if (!el) return;
    if (!knownTags.length) { el.textContent = ''; return; }
    el.innerHTML = '';
    knownTags.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = t;
      el.appendChild(chip);
    });
  }

  function render() {
    const container = document.getElementById('entries');
    container.innerHTML = '';
    entries.forEach((entry, idx) => container.appendChild(renderEntry(entry, idx)));
  }

  function renderEntry(entry, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'add-link-form';
    wrap.style.marginTop = idx === 0 ? '0' : '14px';

    wrap.innerHTML =
      '<p class="add-link-form__title">Link ' + (idx + 1) + '</p>' +
      '<div class="field">' +
        '<label>Title</label>' +
        '<input type="text" data-field="title" data-idx="' + idx + '" value="' + escapeAttr(entry.title) + '" placeholder="e.g. How to draw a correct ß">' +
      '</div>' +
      '<div class="field">' +
        '<label>URL</label>' +
        '<input type="url" data-field="url" data-idx="' + idx + '" value="' + escapeAttr(entry.url) + '" placeholder="https://…">' +
      '</div>' +
      '<div class="field">' +
        '<label>Tags (comma-separated — see the list above)</label>' +
        '<input type="text" data-field="tags" data-idx="' + idx + '" value="' + escapeAttr(entry.tags) + '" placeholder="e.g. german, eszett">' +
      '</div>' +
      '<div class="field">' +
        '<label>Explanation (a sentence or two)</label>' +
        '<textarea data-field="explanation" data-idx="' + idx + '" placeholder="What this resource shows, specifically.">' + escapeHtml(entry.explanation) + '</textarea>' +
      '</div>' +
      (entries.length > 1
        ? '<div class="actions-row"><button type="button" class="btn btn--danger-ghost" data-remove-idx="' + idx + '">Remove this link</button></div>'
        : '');

    return wrap;
  }

  function bindEvents() {
    const container = document.getElementById('entries');

    container.addEventListener('input', (e) => {
      const idxAttr = e.target.getAttribute('data-idx');
      const field = e.target.getAttribute('data-field');
      if (idxAttr === null || !field) return;
      entries[Number(idxAttr)][field] = e.target.value;
    });

    container.addEventListener('click', (e) => {
      const removeAttr = e.target.getAttribute('data-remove-idx');
      if (removeAttr === null) return;
      entries.splice(Number(removeAttr), 1);
      render();
    });

    document.getElementById('btn-add-entry').addEventListener('click', () => {
      entries.push({ title: '', url: '', tags: '', explanation: '' });
      render();
      const container2 = document.getElementById('entries');
      if (container2.lastElementChild && typeof container2.lastElementChild.scrollIntoView === 'function') {
        container2.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    document.getElementById('btn-create-pr').addEventListener('click', onCreatePR);
    document.getElementById('btn-copy-again').addEventListener('click', () => {
      const text = document.getElementById('pr-preview-pre').textContent;
      copyToClipboard(text).then((ok) => {
        showToast(ok ? 'Copied.' : "Couldn't copy automatically — select the text and copy it by hand.");
      });
    });

    document.getElementById('btn-create-tutorial-file').addEventListener('click', onCreateTutorialFile);
    document.getElementById('btn-create-tutorial-entry').addEventListener('click', onCreateTutorialEntry);
    document.getElementById('btn-copy-tutorial-again').addEventListener('click', () => {
      const text = document.getElementById('tutorial-preview-pre').textContent;
      copyToClipboard(text).then((ok) => {
        showToast(ok ? 'Copied.' : "Couldn't copy automatically — select the text and copy it by hand.");
      });
    });
  }

  function buildPayload() {
    const usable = entries
      .map((e) => ({
        title: e.title.trim(),
        url: e.url.trim(),
        tags: e.tags.trim(),
        explanation: e.explanation.trim()
      }))
      .filter((e) => e.title || e.url || e.tags || e.explanation);

    if (!usable.length) return { error: 'Add at least one link first.' };
    const invalid = usable.filter((e) => !e.title || !e.url);
    if (invalid.length) return { error: 'Every link needs at least a title and a URL.' };

    const usedIds = new Set();
    const payload = usable.map((e) => {
      let id = slugify(e.title);
      let n = 2;
      while (usedIds.has(id)) { id = slugify(e.title) + '-' + n; n++; }
      usedIds.add(id);
      return {
        id: id,
        title: e.title,
        url: e.url,
        tags: e.tags ? e.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        explanation: e.explanation
      };
    });
    return { payload: payload };
  }

  // Formats each new entry as a standalone, comma-terminated object,
  // indented one level in — meant to be pasted right after the array's
  // opening "[" in data/links-database.json, before the existing entries.
  // That spot (rather than before the closing "]") means never having to
  // worry about whether the previous last entry already ends in a comma.
  function buildSnippet(payload) {
    return payload.map((entry) => {
      const json = JSON.stringify(entry, null, 2);
      return json.split('\n').map((line) => '  ' + line).join('\n');
    }).join(',\n') + ',';
  }

  async function onCreatePR() {
    const result = buildPayload();
    if (result.error) {
      showToast(result.error);
      return;
    }

    const snippet = buildSnippet(result.payload);
    showPreview(snippet);

    const editUrl = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/edit/' + REPO_BRANCH + '/' + DB_PATH;
    // Open first, synchronously, so popup blockers still see this as a
    // direct result of the click — the clipboard write below is async.
    window.open(editUrl, '_blank', 'noopener');

    const copied = await copyToClipboard(snippet);
    showToast(copied
      ? 'Copied — GitHub opened in a new tab. Paste right after the opening [ .'
      : "GitHub opened in a new tab. Couldn't auto-copy — copy the snippet below by hand.");
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function showPreview(snippet) {
    const box = document.getElementById('pr-preview');
    const pre = document.getElementById('pr-preview-pre');
    pre.textContent = snippet;
    box.classList.add('is-visible');
  }

  // --- Tutorials ------------------------------------------------------------
  // A tutorial touches two files, so it's two explicit steps rather than one
  // button: (1) create the .md file — a brand-new file, so GitHub's URL
  // pre-fill trick works cleanly; (2) copy its entry for data/tutorials.json
  // and open that file for editing, same pattern as the links flow above.
  // Both steps derive the same filename from the title, so as long as the
  // title isn't changed between clicks, they stay in sync.

  function buildTutorialFilename(title) {
    const today = new Date().toISOString().slice(0, 10);
    return 'tutorial-' + today + '-' + slugify(title || 'tutorial') + '.md';
  }

  function onCreateTutorialFile() {
    const title = document.getElementById('tut-title').value.trim();
    const content = document.getElementById('tut-content').value;

    if (!title) { showToast('Give the tutorial a title first.'); return; }
    if (!content.trim()) { showToast('Write the tutorial content first.'); return; }

    const filename = buildTutorialFilename(title);
    const md = /\n$/.test(content) ? content : content + '\n';

    const url = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/new/' + REPO_BRANCH
      + '?filename=' + encodeURIComponent(SITE_DIR + filename)
      + '&value=' + encodeURIComponent(md);

    if (url.length > 7000) {
      showToast("That's a lot of content — the GitHub link may be too long. Try a shorter tutorial, or create the file by hand.");
      return;
    }

    window.open(url, '_blank', 'noopener');
    showToast('Opening GitHub to create ' + filename + '…');
  }

  function onCreateTutorialEntry() {
    const title = document.getElementById('tut-title').value.trim();
    const tagsRaw = document.getElementById('tut-tags').value.trim();
    const description = document.getElementById('tut-description').value.trim();

    if (!title) { showToast('Give the tutorial a title first.'); return; }

    const filename = buildTutorialFilename(title);
    const entry = {
      id: slugify(title),
      title: title,
      path: filename,
      tags: tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [],
      description: description
    };
    const json = JSON.stringify(entry, null, 2);
    const snippet = json.split('\n').map((line) => '  ' + line).join('\n') + ',';

    showTutorialPreview(snippet);

    const editUrl = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/edit/' + REPO_BRANCH + '/' + TUTORIALS_DB_PATH;
    window.open(editUrl, '_blank', 'noopener');

    copyToClipboard(snippet).then((copied) => {
      showToast(copied
        ? 'Copied — GitHub opened in a new tab. Paste right after the opening [ in data/tutorials.json.'
        : "GitHub opened in a new tab. Couldn't auto-copy — copy the snippet below by hand.");
    });
  }

  function showTutorialPreview(snippet) {
    const box = document.getElementById('tutorial-preview');
    const pre = document.getElementById('tutorial-preview-pre');
    pre.textContent = snippet;
    box.classList.add('is-visible');
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

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 4600);
  }
})();
