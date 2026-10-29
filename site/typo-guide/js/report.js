/* ==========================================================================
   Full report page (report.html).
   ----------------------------------------------------------------------
   report.html#?<payload>      the full report stored in the link
                               (see js/urlhosted.js for the format)
   report.html?tutorial=<id>   one tutorial from data/tutorials.json,
                               linked from the GitHub comment

   The payload is text anyone can write, so everything is built with DOM
   calls and text nodes (never innerHTML), and Markdown goes through
   js/markdown.js, which filters links and images.
   ========================================================================== */

(function () {
  'use strict';

  const STATUS_LABEL = { FATAL: 'Fatal', ERROR: 'Error', FAIL: 'Fail', WARN: 'Warning' };

  document.addEventListener('DOMContentLoaded', init);
  window.addEventListener('hashchange', () => window.location.reload());

  /* --------------------------------- helpers --------------------------------- */

  function h(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    (children || []).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function text(tag, className, value) {
    const node = h(tag, className);
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function md(markdown, opts) {
    const box = h('div', 'md');
    box.appendChild(Markdown.render(markdown, Object.assign({ linkTarget: '_blank' }, opts || {})));
    return box;
  }

  // Plain text whose http(s) addresses become links (Fontspector messages).
  function linkified(tag, className, value) {
    const node = h(tag, className);
    const re = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
    let last = 0;
    let m;
    while ((m = re.exec(value))) {
      if (m.index > last) node.appendChild(document.createTextNode(value.slice(last, m.index)));
      node.appendChild(externalLink(m[0], m[0]));
      last = m.index + m[0].length;
    }
    if (last < value.length) node.appendChild(document.createTextNode(value.slice(last)));
    return node;
  }

  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function arr(v) { return Array.isArray(v) ? v : []; }

  function slugifyCategory(cat) {
    return str(cat).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function externalLink(label, url, className) {
    const href = Markdown.safeHref(url);
    if (!href) return text('span', className, label);
    const a = text('a', className, label);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
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

  function setHeader(mark, title, subtitle) {
    document.getElementById('r-mark').textContent = mark;
    document.getElementById('r-title').textContent = title;
    document.getElementById('r-subtitle').textContent = subtitle || '';
  }

  function sectionShell(num, id, title, intro) {
    const sec = h('section', 'section report-section');
    sec.id = id;
    sec.appendChild(h('div', 'section__head', [text('span', 'section__num', String(num).padStart(2, '0')), text('h2', null, title)]));
    if (intro) sec.appendChild(intro);
    return sec;
  }

  // Same speech bubble as in the generator (css/style.css .comment-bubble).
  function commentBubble(comment) {
    return h('div', 'comment-bubble comment-bubble--static', [
      text('span', 'comment-bubble__label', 'Reviewer note'),
      md(comment, { breaks: true })
    ]);
  }

  /* ---------------------------------- entry ---------------------------------- */

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const tutorialId = params.get('tutorial');
    if (tutorialId) return renderTutorialPage(tutorialId);

    const payload = UrlHosted.payloadFromHash(window.location.hash);
    if (!payload) return renderMessage('empty');

    let report;
    try {
      report = await UrlHosted.deserialize(payload);
    } catch (err) {
      console.error(err);
      return renderMessage('broken', err);
    }
    if (!report || typeof report !== 'object' || Array.isArray(report)) return renderMessage('broken');

    if (report.app !== 'typo-guide-generator') {
      // Something made with another urlHosted app (title / author / content):
      // still readable, shown as a plain article.
      if (typeof report.content === 'string') return renderPlainArticle(report);
      return renderMessage('broken');
    }
    renderReport(report);
  }

  /* --------------------------------- messages -------------------------------- */

  function renderMessage(kind, err) {
    const root = document.getElementById('report-root');
    root.innerHTML = '';
    const box = h('section', 'section report-message');
    if (kind === 'empty') {
      setHeader('Typo Guide Generator · Full report', 'No report in this link', '');
      box.appendChild(text('p', null, 'A full report opens from the link in a GitHub comment made with Typo Guide Generator. The whole report is stored in that link, after “#?”, so this page has nothing to show without it.'));
    } else {
      setHeader('Typo Guide Generator · Full report', 'This report link is incomplete', '');
      box.appendChild(text('p', null, 'The report data in this link could not be read. It was most likely cut off when it was copied: open the link straight from the GitHub comment, or copy the whole link again.'));
      if (err && err.message) box.appendChild(text('p', 'report-message__detail', 'Details: ' + err.message));
    }
    const actions = h('div', 'actions-row actions-row--start');
    const a = text('a', 'btn btn--primary', 'Open the generator');
    a.href = 'index.html';
    actions.appendChild(a);
    box.appendChild(actions);
    root.appendChild(box);
  }

  function renderPlainArticle(data) {
    setHeader('urlHosted article', str(data.title) || '(untitled)', [str(data.author), GitHubComment.formatDate(data.date)].filter(Boolean).join(' · '));
    document.title = (str(data.title) || 'Article') + ' · urlHosted';
    const root = document.getElementById('report-root');
    root.innerHTML = '';
    const sec = h('section', 'section report-section');
    sec.appendChild(md(str(data.content), { idPrefix: 'a-' }));
    root.appendChild(sec);
  }

  /* ---------------------------------- report --------------------------------- */

  function renderReport(r) {
    const project = str(r.project);
    const title = str(r.title) || 'Typography review';
    const date = GitHubComment.formatDate(r.date);
    setHeader('Typo Guide Generator · Full report', project || title,
      [project ? title : '', r.designer ? 'for ' + str(r.designer) : '', date].filter(Boolean).join(' · '));
    document.title = (project || title) + ' · Full report';

    const root = document.getElementById('report-root');
    root.innerHTML = '';

    const problems = arr(r.problems);
    const tutorials = arr(r.tutorials).filter((t) => t && typeof t.markdown === 'string');
    const fs = r.fontspector && typeof r.fontspector === 'object' ? r.fontspector : null;
    const checks = fs ? arr(fs.checks) : [];
    const shots = arr(r.screenshots);
    const stats = GitHubComment.stats({ problems: problems, tutorials: tutorials, fontspector: fs, screenshots: shots });

    // Which sections exist decides their numbers.
    const sections = [];
    if (problems.length) sections.push({ id: 'sec-issues', title: problems.some((p) => !p.manual) ? 'Design & production issues' : 'Resources', build: (n) => buildIssues(n, problems, tutorials, shots) });
    if (checks.length) sections.push({ id: 'sec-fontspector', title: 'Fontspector checks', build: (n) => buildFontspector(n, fs, checks) });
    if (tutorials.length) sections.push({ id: 'sec-tutorials', title: 'Tutorials', build: (n) => buildTutorials(n, tutorials) });
    if (shots.length) sections.push({ id: 'sec-screenshots', title: 'Screenshots', build: (n) => buildScreenshots(n, shots, problems) });

    root.appendChild(buildSummary(Object.assign({}, r, { problems: problems, tutorials: tutorials, fontspector: fs, screenshots: shots }), stats, sections));
    sections.forEach((s, i) => root.appendChild(s.build(i + 1)));
    if (r.author || r.contact) root.appendChild(buildReviewer(r, date));

    bindActions(r);
  }

  function buildSummary(r, stats, sections) {
    const sec = h('section', 'section report-summary');

    const chips = h('div', 'r-chips');
    function chip(n, label, dot) {
      if (!n) return;
      chips.appendChild(h('span', 'r-chip', [dot ? h('span', 'status-dot status-dot--' + dot) : null, h('strong', null, [String(n)]), ' ' + label]));
    }
    chip(stats.problems, stats.problems === 1 ? 'issue' : 'issues');
    chip(stats.fail, stats.fail === 1 ? 'fail' : 'fails', 'fail');
    chip(stats.warn, stats.warn === 1 ? 'warning' : 'warnings', 'warn');
    chip(stats.tutorials, stats.tutorials === 1 ? 'tutorial' : 'tutorials');
    chip(stats.links, stats.links === 1 ? 'link' : 'links');
    chip(stats.screenshots, stats.screenshots === 1 ? 'screenshot' : 'screenshots');
    sec.appendChild(chips);

    if (r.notes) sec.appendChild(h('div', 'r-notes', [md(str(r.notes), { breaks: true })]));

    // The same to-do list as the GitHub comment, each item leading to its details.
    const todo = GitHubComment.todoItems(r);
    if (todo.length) {
      sec.appendChild(text('p', 'r-eyebrow r-todo__title', 'To do'));
      const list = h('ul', 'r-todo');
      todo.forEach((it) => {
        const target = it.kind === 'problem' ? 'issue-' + Markdown.slug(it.problemId) : it.kind === 'fontspector' ? 'sec-fontspector' : 'sec-screenshots';
        const box = h('span', 'r-todo__box');
        box.setAttribute('aria-hidden', 'true');
        list.appendChild(h('li', null, [box, scrollLink(it.short, target, 'r-todo__link')]));
      });
      sec.appendChild(list);
    }

    if (sections.length) {
      const toc = h('ol', 'r-toc');
      sections.forEach((s, i) => {
        const a = h('a', null, [text('span', 'r-toc__num', String(i + 1).padStart(2, '0')), text('span', null, s.title)]);
        a.href = '#' + s.id;
        a.addEventListener('click', (e) => {
          // keep the report payload in the address bar: scroll instead of navigating
          e.preventDefault();
          document.getElementById(s.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        toc.appendChild(h('li', null, [a]));
      });
      sec.appendChild(toc);
    }
    return sec;
  }

  function scrollLink(label, targetId, className) {
    const a = text('a', className, label);
    a.href = '#' + targetId;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(targetId);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return a;
  }

  function buildIssues(num, problems, tutorials, shots) {
    const sec = sectionShell(num, 'sec-issues', problems.some((p) => !p.manual) ? 'Design & production issues' : 'Resources',
      text('p', 'section__intro', 'What came up while reviewing the font, with resources to fix each point.'));
    const byId = {};
    tutorials.forEach((t) => { byId[t.id] = t; });

    const list = h('div', 'r-problems');
    problems.forEach((p) => {
      const card = h('article', 'r-problem cat-' + (p.manual ? 'technical' : slugifyCategory(p.category)));
      if (!p.manual && p.id) card.id = 'issue-' + Markdown.slug(p.id);
      card.appendChild(text('span', 'problem-card__category', p.manual ? 'Additional resources' : str(p.category)));
      if (!p.manual) card.appendChild(text('h3', 'r-problem__label', str(p.label)));

      // screenshots linked to this issue
      const linkedShots = [];
      shots.forEach((sh, i) => { if (!p.manual && sh && sh.problem && sh.problem === p.id) linkedShots.push(i); });
      if (linkedShots.length) {
        card.appendChild(h('div', 'r-problem__shots', [
          scrollLink((linkedShots.length === 1 ? 'Screenshot ' : 'Screenshots ') + linkedShots.map((i) => i + 1).join(', '), 'shot-' + (linkedShots[0] + 1), 'r-shots-ref')
        ]));
      }

      arr(p.tutorials).forEach((id) => {
        const t = byId[id];
        if (!t) return;
        card.appendChild(h('div', 'r-tutorial-ref', [text('span', 'tutorial-badge', 'Tutorial'), scrollLink(str(t.title), 'tut-' + Markdown.slug(t.id), 'r-tutorial-ref__title')]));
      });

      const links = arr(p.links);
      if (links.length) {
        const grid = h('div', 'r-links');
        links.forEach((l) => {
          const row = h('div', 'r-link');
          row.appendChild(externalLink(str(l.title), str(l.url), 'r-link__title'));
          row.appendChild(externalLink(str(l.url), str(l.url), 'link-row__url'));
          if (l.explanation) row.appendChild(text('p', 'link-row__explain', str(l.explanation)));
          grid.appendChild(row);
        });
        card.appendChild(grid);
      } else if (!arr(p.tutorials).length) {
        card.appendChild(text('p', 'r-problem__empty', 'See the notes from the reviewer.'));
      }
      list.appendChild(card);
    });
    sec.appendChild(list);
    return sec;
  }

  function buildFontspector(num, fs, checks) {
    const intro = h('p', 'section__intro', [
      'You can check this font yourself on ',
      externalLink('Fontspector', GitHubComment.FONTSPECTOR_WEB),
      ', using the Google Fonts profile — below is a curated selection of the fails and warnings worth resolving first.'
    ]);
    const sec = sectionShell(num, 'sec-fontspector', 'Fontspector checks', intro);

    const ran = [];
    if (fs.version) ran.push('Fontspector ' + str(fs.version));
    if (fs.profile) ran.push(str(fs.profile) + ' profile');
    if (arr(fs.files).length) ran.push(arr(fs.files).map(str).join(', '));
    // how many fails / warnings the whole run found, next to how many were picked
    const counts = fs.counts && typeof fs.counts === 'object' ? fs.counts : null;
    if (counts) {
      const total = ['FATAL', 'ERROR', 'FAIL', 'WARN']
        .filter((k) => typeof counts[k] === 'number' && counts[k] > 0)
        .map((k) => counts[k] + ' ' + k);
      if (total.length) ran.push('in total ' + total.join(', ') + ' — ' + checks.length + ' picked here');
    }
    if (ran.length) sec.appendChild(text('p', 'r-fs-meta', 'Checked with ' + ran.join(' · ')));

    const list = h('div', 'r-checks');
    checks.forEach((c) => {
      const status = str(c.status).toUpperCase();
      const lower = status.toLowerCase().replace(/[^a-z]/g, '');
      const card = h('article', 'r-check check-row--' + lower);
      const head = h('div', 'check-row__head', [
        text('span', 'check-badge check-badge--' + lower, status),
        text('span', 'check-row__id', str(c.id)),
        c.filename ? text('span', 'r-check__file', str(c.filename)) : null
      ]);
      head.firstChild.title = STATUS_LABEL[status] || status;
      card.appendChild(head);
      if (c.title) card.appendChild(text('h3', 'r-check__title', str(c.title)));
      if (c.message) card.appendChild(linkified('p', 'r-check__message', str(c.message)));
      if (c.comment && str(c.comment).trim()) card.appendChild(commentBubble(str(c.comment)));
      list.appendChild(card);
    });
    sec.appendChild(list);
    return sec;
  }

  function buildTutorials(num, tutorials) {
    const sec = sectionShell(num, 'sec-tutorials', 'Tutorials',
      text('p', 'section__intro', 'Step-by-step guides for the issues above, included in full.'));
    tutorials.forEach((t) => {
      const art = h('article', 'r-tutorial');
      art.id = 'tut-' + Markdown.slug(t.id);
      art.appendChild(text('span', 'tutorial-badge', 'Tutorial'));
      art.appendChild(text('h3', 'r-tutorial__title', str(t.title)));
      art.appendChild(md(str(t.markdown), { dropTitle: str(t.title), headingOffset: 2, idPrefix: art.id + '-' }));
      sec.appendChild(art);
    });
    return sec;
  }

  function buildScreenshots(num, shots, problems) {
    const labels = {};
    problems.forEach((p) => { if (p && p.id && !p.manual) labels[p.id] = str(p.label); });
    const sec = sectionShell(num, 'sec-screenshots', 'Screenshots',
      text('p', 'section__intro', 'The issues, shown on the font itself.'));
    const list = h('div', 'r-shots');
    shots.forEach((s, i) => {
      const fig = h('figure', 'r-shot');
      fig.id = 'shot-' + (i + 1);
      const src = Markdown.safeImageSrc(str(s.src));
      if (src && !s.omitted) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Screenshot ' + (i + 1) + (s.name ? ' — ' + str(s.name) : '');
        img.className = 'r-shot__img';
        img.addEventListener('click', () => fig.classList.toggle('is-zoomed'));
        fig.appendChild(h('div', 'r-shot__frame', [img]));
      } else {
        fig.appendChild(text('div', 'r-shot__missing', 'This image was too heavy to fit in the report link — it is attached to the GitHub comment instead.'));
      }
      const about = s.problem && labels[s.problem]
        ? h('span', 'r-shot__about', ['About: ', scrollLink(labels[s.problem], 'issue-' + Markdown.slug(s.problem))])
        : null;
      const cap = h('figcaption', 'r-shot__caption', [
        text('span', 'r-shot__num', 'Screenshot ' + (i + 1)),
        s.name ? text('span', 'r-shot__name', str(s.name)) : null,
        about
      ]);
      fig.appendChild(cap);
      if (s.comment && str(s.comment).trim()) fig.appendChild(commentBubble(str(s.comment)));
      list.appendChild(fig);
    });
    sec.appendChild(list);
    return sec;
  }

  function buildReviewer(r, date) {
    const sec = h('section', 'section report-reviewer');
    sec.appendChild(text('p', 'r-eyebrow', 'Reviewed by'));
    if (r.author) sec.appendChild(text('p', 'report-reviewer__name', str(r.author)));
    const c = str(r.contact).trim();
    if (c) {
      if (/^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(c)) {
        const a = text('a', 'report-reviewer__contact', c);
        a.href = 'mailto:' + c;
        sec.appendChild(a);
      } else if (/^https?:\/\//i.test(c)) {
        sec.appendChild(externalLink(c, c, 'report-reviewer__contact'));
      } else {
        sec.appendChild(text('p', 'report-reviewer__contact', c));
      }
    }
    if (date) sec.appendChild(text('p', 'report-reviewer__date', date));
    return sec;
  }

  function bindActions(r) {
    document.getElementById('r-actions').hidden = false;

    // The link to share is this very page — but on the public site, never on localhost.
    const shareUrl = TypoConfig.isLocal()
      ? TypoConfig.publicBaseUrl() + 'report.html' + window.location.hash
      : window.location.href;

    document.getElementById('btn-copy-comment').addEventListener('click', async () => {
      const markdown = GitHubComment.build(r, { reportUrl: shareUrl, baseUrl: TypoConfig.publicBaseUrl() });
      const ok = await copyText(markdown);
      showToast(ok ? 'GitHub comment copied — paste it on the issue.' : "Couldn't copy — your browser blocked the clipboard.");
    });

    document.getElementById('btn-print').addEventListener('click', () => window.print());

    document.getElementById('btn-edit').href = TypoConfig.currentBaseUrl() + 'index.html' + window.location.hash;
  }

  /* --------------------------------- tutorial -------------------------------- */

  async function renderTutorialPage(id) {
    setHeader('Typo Guide Generator · Tutorial', 'Loading the tutorial…', '');
    const root = document.getElementById('report-root');
    document.getElementById('r-footer-note').textContent = 'Tutorials are written by the community — suggest one from the generator.';
    try {
      const res = await fetch('data/tutorials.json');
      if (!res.ok) throw new Error('data/tutorials.json: HTTP ' + res.status);
      const list = await res.json();
      const tut = arr(list).find((t) => t && t.id === id);
      if (!tut) throw new Error('there is no tutorial called “' + id + '”');
      const mdRes = await fetch(tut.path);
      if (!mdRes.ok) throw new Error(tut.path + ': HTTP ' + mdRes.status);
      const markdown = await mdRes.text();

      setHeader('Typo Guide Generator · Tutorial', str(tut.title), str(tut.description));
      document.title = str(tut.title) + ' · Tutorial';
      root.innerHTML = '';
      const sec = h('section', 'section report-section');
      const art = h('article', 'r-tutorial r-tutorial--standalone');
      if (arr(tut.tags).length) art.appendChild(h('div', 'tags', arr(tut.tags).map((t) => text('span', 'tag', str(t)))));
      art.appendChild(md(markdown, { dropTitle: str(tut.title), headingOffset: 1, idPrefix: 't-' }));
      sec.appendChild(art);
      root.appendChild(sec);
    } catch (err) {
      console.error(err);
      setHeader('Typo Guide Generator · Tutorial', 'Tutorial not found', '');
      root.innerHTML = '';
      const box = h('section', 'section report-message', [text('p', null, 'This tutorial could not be loaded: ' + err.message + '.')]);
      root.appendChild(box);
    }
  }
})();
