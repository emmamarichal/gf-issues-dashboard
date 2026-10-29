/* ==========================================================================
   The GitHub comment: a very short Markdown checklist, to paste as a
   comment on the font's GitHub issue —

     - [ ] one action per problem checked in step 1 ("Improve the Latin
           accents"), pointing to its screenshots when it has some
     - [ ] one item for the Fontspector checks, followed by the checks the
           reviewer commented on (only those)
     📄 a link to the full report (report.html#?…), which holds everything
        else: screenshots, links, tutorials, all picked Fontspector results.

   Input is the "report" object, the same one stored in the link:
   {
     app, v, title, author, date, project, designer, notes, contact,
     problems:    [{ id, label, action, category, manual, tutorials: [tutorialId], links: [{ id, title, url, explanation }] }],
     tutorials:   [{ id, title, markdown }],
     fontspector: null | { source, version, profile, files, counts, checks: [{ status, id, title, filename, message, comment }] },
     screenshots: [{ name, comment, problem, src, omitted }]   (problem = id of the linked problem, or null)
   }
   ========================================================================== */

const GitHubComment = (function () {
  const FONTSPECTOR_WEB = 'https://fonttools.github.io/fontspector/';
  const STATUS_ICON = { FATAL: '☠️', ERROR: '💥', FAIL: '🔥', WARN: '⚠️' };

  // Text that must show as typed, not as Markdown: escape the characters
  // GitHub would otherwise read as formatting, links, HTML or tables.
  function escapeText(text) {
    return String(text == null ? '' : text)
      .replace(/\s*\n\s*/g, ' ')
      .replace(/([\\`*_[\]<>|~])/g, '\\$1')
      .replace(/^([#+\-]|\d+\.)(\s)/, '\\$1$2')
      .trim();
  }

  function codeSpan(text) {
    const s = String(text == null ? '' : text).replace(/\s*\n\s*/g, ' ');
    const runs = s.match(/`+/g) || [];
    const fence = '`'.repeat(runs.reduce((n, r) => Math.max(n, r.length), 0) + 1);
    const pad = s.charAt(0) === '`' || s.slice(-1) === '`' ? ' ' : '';
    return fence + pad + s + pad + fence;
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function stats(report) {
    const fs = report.fontspector;
    const checks = fs && fs.checks ? fs.checks : [];
    return {
      problems: (report.problems || []).filter((p) => !p.manual).length,
      links: (report.problems || []).reduce((n, p) => n + (p.links || []).length, 0),
      tutorials: (report.tutorials || []).length,
      checks: checks.length,
      fail: checks.filter((c) => c.status === 'FAIL' || c.status === 'FATAL' || c.status === 'ERROR').length,
      warn: checks.filter((c) => c.status === 'WARN').length,
      screenshots: (report.screenshots || []).length
    };
  }

  const BAD = ['FATAL', 'ERROR', 'FAIL'];

  function hasComment(x) { return !!(x && x.comment && String(x.comment).trim()); }

  // "Fix the Fontspector fails" / "Review the Fontspector warnings" / both.
  function fontspectorVerb(checks) {
    const bad = checks.some((c) => BAD.includes(c.status));
    const warn = checks.some((c) => c.status === 'WARN');
    if (bad && warn) return 'Fix the Fontspector fails and warnings';
    if (warn) return 'Review the Fontspector warnings';
    return 'Fix the Fontspector fails';
  }

  /**
   * The to-do list shared by the GitHub comment and the report page:
   * [{ kind: 'problem' | 'fontspector' | 'screenshots', text, short, problemId, screenshots }]
   * text = wording for the comment; short = the same without "in the full
   * report" pointers, for the report page itself.
   */
  function todoItems(report) {
    const items = [];
    const shots = report.screenshots || [];
    const problems = (report.problems || []).filter((p) => !p.manual);
    const problemIds = new Set(problems.map((p) => p.id));
    // screenshots too heavy for the link are attached to the comment instead ("below")
    const seeShots = (inReport, below) => {
      const n = inReport + below;
      if (!n) return '';
      const where = inReport && below ? 'in the full report and below' : inReport ? 'in the full report' : 'below';
      return ' (see the screenshot' + (n === 1 ? '' : 's') + ' ' + where + ')';
    };

    problems.forEach((p) => {
      const mine = shots.filter((sh) => sh.problem && sh.problem === p.id);
      const below = mine.filter((sh) => sh.omitted).length;
      const action = String(p.action || '').trim() || 'Fix: ' + String(p.label || p.id || '').trim();
      items.push({ kind: 'problem', problemId: p.id, screenshots: mine.length, short: action, text: action + seeShots(mine.length - below, below) });
    });

    const fs = report.fontspector;
    const checks = fs && fs.checks ? fs.checks : [];
    if (checks.length) {
      const commented = checks.filter(hasComment).length;
      const rest = checks.length - commented;
      const verb = fontspectorVerb(checks);
      let text = verb;
      if (commented) text += ' listed below' + (rest ? ' (' + rest + ' more in the full report)' : '');
      else text += ' (see the full report)';
      items.push({ kind: 'fontspector', text: text, short: verb, commented: commented });
    }

    const loose = shots.filter((sh) => !sh.problem || !problemIds.has(sh.problem)).length;
    if (loose) {
      const short = 'Go through the ' + (loose < shots.length ? 'other ' : '') + 'annotated screenshot' + (loose === 1 ? '' : 's');
      items.push({ kind: 'screenshots', screenshots: loose, short: short, text: short + ' in the full report' });
    }
    return items;
  }

  // A reviewer comment after "— " on a list item; following lines indented
  // so they stay inside the item (GitHub keeps the line breaks).
  function inlineComment(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').trim().split('\n');
    return lines.map((l, i) => (i === 0 ? l.trim() : (l.trim() ? '  ' + l.replace(/\s+$/, '') : ''))).join('\n');
  }

  /**
   * report          the report object (see top of file)
   * opts.reportUrl  full report link (report.html#?…)
   */
  function build(report, opts) {
    opts = opts || {};
    const out = [];
    const s = stats(report);

    const title = String(report.title || 'Typography review').trim();
    out.push('### ' + escapeText(title) + (report.project ? ' — ' + escapeText(report.project) : ''));
    const d = String(report.designer || '').trim();
    // "@handle" notifies the designer on GitHub; a plain name stays in the report
    if (/^@[\w-]+$/.test(d)) out.push('cc ' + d);
    out.push('');

    if (report.notes && String(report.notes).trim()) { out.push(String(report.notes).trim()); out.push(''); }

    const items = todoItems(report);
    items.forEach((it) => out.push('- [ ] ' + escapeText(it.text)));
    if (items.length) out.push('');

    // Only the Fontspector checks the reviewer commented on.
    const fs = report.fontspector;
    const commented = fs && fs.checks ? fs.checks.filter(hasComment) : [];
    if (commented.length) {
      out.push('**Fontspector** · you can run the checks yourself on [Fontspector](' + FONTSPECTOR_WEB + ') with the Google Fonts profile');
      commented.forEach((c) => {
        let line = '- ' + (STATUS_ICON[c.status] ? STATUS_ICON[c.status] + ' ' : '') + '**' + escapeText(c.status) + '** ' + codeSpan(c.id);
        if (c.filename) line += ' · ' + codeSpan(c.filename);
        out.push(line + ' — ' + inlineComment(c.comment));
      });
      out.push('');
    }

    if (opts.reportUrl) {
      const inside = [];
      if (s.screenshots) inside.push('screenshots');
      if (s.links) inside.push('links');
      if (s.tutorials) inside.push('tutorials');
      if (s.checks) inside.push('the complete Fontspector results');
      const list = inside.length > 1 ? inside.slice(0, -1).join(', ') + ' and ' + inside[inside.length - 1] : inside[0];
      out.push('📄 **[Full report](' + opts.reportUrl + ')**' + (list ? ' — ' + list + '.' : ''));
    }

    // Screenshots that didn't fit in the link get attached to the comment by hand.
    const omitted = (report.screenshots || []).filter((sh) => sh.omitted);
    if (omitted.length) {
      out.push('');
      out.push('📎 Too heavy for the link, attached here: ' + omitted.map((sh) => codeSpan(sh.name || 'screenshot')).join(', '));
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  return {
    build: build,
    todoItems: todoItems,
    stats: stats,
    escapeText: escapeText,
    codeSpan: codeSpan,
    formatDate: formatDate,
    FONTSPECTOR_WEB: FONTSPECTOR_WEB
  };
})();
