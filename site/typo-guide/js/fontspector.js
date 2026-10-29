/* ==========================================================================
   Fontspector report parser — accepts JSON *or* free text.
   ----------------------------------------------------------------------
   Most people won't have a JSON file handy; the realistic case is
   copy-pasting from a --ghmarkdown report, a terminal, or the official
   web tool's on-screen results. So: try JSON.parse() first (still fully
   supported, still the most reliable if you have it) — if that fails,
   fall back to a line-by-line scan for the patterns real fontbakery/
   fontspector-family reports actually use: severity emoji (🔥 FAIL,
   ⚠️ WARN, 💥 ERROR, ⏩ SKIP, ℹ️ INFO, ✅ PASS), the bare status words
   themselves, and a check identifier nearby (a "Check ID:" label, a
   Markdown heading, a backtick-wrapped token, or any bare dotted/
   slashed identifier such as opentype/family/underline_thickness).
   ========================================================================== */

const Fontspector = (function () {
  const STATUS_ORDER = ['ERROR', 'FATAL', 'FAIL', 'WARN', 'INFO', 'SKIP', 'PASS'];
  const STATUS_WORDS = ['ERROR', 'FATAL', 'FAIL', 'WARN', 'WARNING', 'INFO', 'SKIP', 'PASS'];
  const STATUS_WORD_RE = new RegExp('\\b(' + STATUS_WORDS.join('|') + ')\\b', 'i');

  const STATUS_EMOJI = {
    '💥': 'ERROR', '💔': 'ERROR',
    '🔥': 'FAIL',
    '⚠️': 'WARN', '⚠': 'WARN',
    '⏩': 'SKIP', '💤': 'SKIP',
    'ℹ️': 'INFO', 'ℹ': 'INFO',
    '✅': 'PASS', '☑️': 'PASS', '☑': 'PASS'
  };

  function normalizeStatus(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const up = raw.trim().toUpperCase();
    if (up === 'WARNING') return 'WARN';
    if (up === 'ERR') return 'ERROR';
    return STATUS_ORDER.includes(up) ? up : null;
  }

  /* ---------------------------- JSON parsing path --------------------------- */

  function flattenId(idLike) {
    if (idLike == null) return null;
    if (Array.isArray(idLike)) return idLike.map(flattenId).filter(Boolean).join(' / ');
    if (typeof idLike === 'object') return idLike.id || idLike.key || idLike.check_id || null;
    return String(idLike);
  }

  // Recursively walks a parsed JSON report and collects every "check
  // result" object: a known status accompanied by an identifier.
  function extractChecksFromJson(root) {
    const found = [];
    const seen = new Set();

    function walk(node, ctx) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);

      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, ctx));
        return;
      }

      const status = normalizeStatus(node.status || node.result || node.level || node.severity);
      const idLike = flattenId(
        node.check_id || node.checkid || node.checkId || node.code || node.key || node.id
      ) || ctx.id;
      const msgLike = node.message || node.description || node.rationale || node.reason || node.msg;

      if (status && idLike) {
        found.push({
          id: idLike,
          status: status,
          message: msgLike ? String(msgLike).trim() : (ctx.message || ''),
          filename: node.filename || node.file || ctx.filename || null
        });
      }

      const nextCtx = {
        id: idLike || ctx.id,
        filename: node.filename || node.file || ctx.filename,
        message: (msgLike ? String(msgLike).trim() : ctx.message)
      };

      Object.keys(node).forEach((key) => {
        if (['status', 'result', 'level', 'severity'].includes(key)) return;
        walk(node[key], nextCtx);
      });
    }

    walk(root, {});
    return found;
  }

  /* --------------------------- Free-text parsing path ------------------------ */

  // Does this token look like a check identifier, e.g.
  // "opentype/family/underline_thickness" or "com.google.fonts/check/x"?
  // Deliberately stricter than "has a dot" — a plain filename like
  // "Marvel-BoldItalic.ttf" must NOT qualify, since font filenames show up
  // constantly in these reports and would otherwise corrupt the id context.
  function looksLikeCheckId(token) {
    if (!token) return false;
    const t = String(token).replace(/^[`*_<>(]+|[`*_<>):.,]+$/g, '');
    if (t.length < 6 || /\s/.test(t)) return false;
    if (!/^[A-Za-z0-9_.\/-]+$/.test(t)) return false;
    if (/\.(ttf|otf|woff2?|ttc)$/i.test(t)) return false; // font filename, not a check id
    const hasSlash = t.indexOf('/') !== -1;
    const dotSegments = t.split('.').length - 1;
    return hasSlash || dotSegments >= 2; // path-like, or dotted.like.this.id
  }

  function extractIdFromLine(line) {
    // "Check ID: <FontBakeryCheck:xyz>" or "Check ID: xyz"
    const labelled = line.match(/check[\s_-]?id\s*:?\s*<?(?:[A-Za-z]+Check:)?([A-Za-z0-9_.\/-]+)>?/i);
    if (labelled && looksLikeCheckId(labelled[1])) return labelled[1];

    // Markdown heading: "## some/check-id" or "### com.google.fonts/check/x"
    const heading = line.match(/^#{1,4}\s+`?([A-Za-z0-9_.\/-]{6,})`?\s*$/);
    if (heading && looksLikeCheckId(heading[1])) return heading[1];

    // any backtick-wrapped identifier-looking token
    const backticked = line.match(/`([A-Za-z0-9_.\/-]{6,})`/);
    if (backticked && looksLikeCheckId(backticked[1])) return backticked[1];

    // otherwise, any bare identifier-looking token on the line
    const tokens = line.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      if (looksLikeCheckId(tokens[i])) return tokens[i].replace(/^[`*_<>(]+|[`*_<>):.,]+$/g, '');
    }
    return null;
  }

  function stripStatusMarkers(line) {
    let out = line;
    Object.keys(STATUS_EMOJI).forEach((emoji) => { out = out.split(emoji).join(''); });
    out = out.replace(STATUS_WORD_RE, '');
    out = out.replace(/^[\s•\-*:]+|[\s:]+$/g, '');
    return out.trim();
  }

  // How many *distinct* statuses appear on this one line? A real check
  // result names exactly one status. A line naming two or more (this is
  // Fontspector's actual summary-table header row: "| 🔥 FAIL | ⚠️ WARN |
  // ℹ️ INFO | ✅ PASS | ⏩ SKIP |", followed by a row of totals and a row
  // of percentages) is the aggregate counts table, not an individual
  // result — treating it as one would produce a garbled, useless entry.
  function countDistinctStatusesOnLine(line) {
    const found = new Set();
    Object.keys(STATUS_EMOJI).forEach((emoji) => {
      if (line.indexOf(emoji) !== -1) found.add(STATUS_EMOJI[emoji]);
    });
    const wordRe = new RegExp('\\b(' + STATUS_WORDS.join('|') + ')\\b', 'gi');
    let m;
    while ((m = wordRe.exec(line)) !== null) found.add(normalizeStatus(m[1]));
    return found.size;
  }

  // A line that's just an emoji + a bare font filename (a common fontbakery-
  // family idiom marking *which file* a result applies to) isn't itself a
  // useful message — the real status + message almost always follows a line
  // or two later. Skip these so they don't produce a near-duplicate, low-
  // information entry alongside the real one.
  function looksLikeBareFilenameLine(message) {
    return /^[\w.\-]+\.(ttf|otf|woff2?|ttc)$/i.test(message);
  }

  function extractChecksFromText(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const found = [];
    let lastId = null;
    let sinceId = Infinity;
    let sawSummaryRow = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) { sinceId++; continue; }

      if (countDistinctStatusesOnLine(line) >= 2) {
        // Summary/header row (or the "----" / percentages rows around it) —
        // not an individual result. Skip it entirely rather than guessing
        // which of its several statuses was "the" one.
        sawSummaryRow = true;
        sinceId++;
        continue;
      }

      const idHere = extractIdFromLine(line);
      if (idHere) { lastId = idHere; sinceId = 0; }

      let status = null;
      for (const emoji in STATUS_EMOJI) {
        if (line.indexOf(emoji) !== -1) { status = STATUS_EMOJI[emoji]; break; }
      }
      if (!status) {
        const m = line.match(STATUS_WORD_RE);
        if (m) status = normalizeStatus(m[1]);
      }

      if (status) {
        let message = stripStatusMarkers(line);

        // A bare status marker with nothing else on the line (e.g. a lone
        // "• 🔥 FAIL") carries its real description on the next non-empty
        // line(s) — pull those in rather than recording an empty message.
        let lookahead = i + 1;
        while (message.length < 3 && lookahead < lines.length) {
          const next = lines[lookahead].trim();
          if (!next) { lookahead++; continue; }
          if (extractIdFromLine(next) || STATUS_WORD_RE.test(next) || Object.keys(STATUS_EMOJI).some((e) => next.indexOf(e) !== -1)) break;
          message = next;
          break;
        }

        if (!looksLikeBareFilenameLine(message)) {
          const id = idHere || (sinceId <= 6 ? lastId : null) || ('check-' + (found.length + 1));
          found.push({ id: id, status: status, message: message, filename: null });
        }
      }

      if (!idHere) sinceId++;
    }

    return { found: found, sawSummaryRow: sawSummaryRow };
  }

  /* --------------------------------- Shared ---------------------------------- */

  function dedupe(list) {
    const map = new Map();
    list.forEach((item) => {
      const k = [item.id, item.status, item.message, item.filename || ''].join('|');
      if (!map.has(k)) map.set(k, item);
    });
    return Array.from(map.values());
  }

  function summarize(checks) {
    const counts = {};
    STATUS_ORDER.forEach((s) => { counts[s] = 0; });
    checks.forEach((c) => {
      if (counts[c.status] !== undefined) counts[c.status]++;
    });
    return counts;
  }

  // Main entry point: accepts whatever was pasted, JSON or not.
  function parseReport(input) {
    let checks = [];
    let sawSummaryRow = false;

    if (typeof input === 'object' && input !== null) {
      checks = extractChecksFromJson(input);
    } else {
      const raw = String(input);
      let asJson = null;
      try { asJson = JSON.parse(raw); } catch (e) { /* not JSON — fall through to text */ }
      if (asJson !== null) {
        checks = extractChecksFromJson(asJson);
      } else {
        const textResult = extractChecksFromText(raw);
        checks = textResult.found;
        sawSummaryRow = textResult.sawSummaryRow;
      }
    }

    checks = dedupe(checks);
    return {
      checks: checks,
      counts: summarize(checks),
      // True when the pasted text contained a line naming 2+ statuses at
      // once (Fontspector's aggregate summary table) but no individual
      // check results were otherwise found — i.e. likely only the totals
      // were pasted, not the detailed listing underneath them.
      looksLikeSummaryOnly: sawSummaryRow && checks.length === 0
    };
  }

  /* ------------------- Results from the in-browser engine ------------------- */

  // Fontspector messages are Markdown (bold, inline code, bullet lists,
  // sometimes a small HTML fragment). The interface and the PDF both show
  // them as plain text: readable, and never at risk of a half-rendered table.
  function messageToPlainText(md) {
    return String(md || '')
      .replace(/\r\n/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Converts the CheckResult[] returned by the engine (see js/fontspector-
  // worker.js) into the same shape parseReport() produces, plus the extra
  // details only the real engine knows: the human-readable check title and
  // which font file a result is about (null = a family-wide check).
  function fromCheckResults(results) {
    const checks = (results || []).map((r) => {
      const status = normalizeStatus(r.worst_status) || 'PASS';
      const subs = (r.subresults || []).filter((s) => s.message);
      const relevant = subs.filter((s) => ['WARN', 'FAIL', 'FATAL', 'ERROR'].includes(normalizeStatus(s.severity)));
      const shown = relevant.length ? relevant : subs;
      const seen = new Set();
      const message = shown.map((s) => {
        const sev = normalizeStatus(s.severity);
        const text = messageToPlainText(s.message);
        return sev && sev !== status && shown.length > 1 ? sev + ': ' + text : text;
      }).filter((m) => {
        // the same message repeated for several name records, glyphs… is shown once
        if (seen.has(m)) return false;
        seen.add(m);
        return true;
      }).join('\n\n');

      return {
        id: r.check_id,
        title: r.check_name || '',
        status: status,
        message: message,
        filename: r.filename ? String(r.filename).split(/[\\/]/).pop() : null
      };
    });
    return { checks: checks, counts: summarize(checks) };
  }

  return {
    STATUS_ORDER: STATUS_ORDER,
    parseReport: parseReport,
    fromCheckResults: fromCheckResults,
    messageToPlainText: messageToPlainText
  };
})();
