/* ==========================================================================
   A small, safe Markdown renderer (Markdown → DOM nodes).
   ----------------------------------------------------------------------
   Used for the GitHub comment preview in the generator and for everything
   on the full report page (tutorials, notes, comments).

   Supports the GitHub-flavoured subset this tool actually produces or
   reads: ATX and setext headings, paragraphs, bullet / numbered / task
   lists (nested by indentation), blockquotes (nested), fenced and
   indented code blocks, tables, horizontal rules, **bold**, *italic*,
   ~~strikethrough~~, `code`, [links](url), ![images](url), <autolinks>
   and bare https:// links.

   Safety: the report page renders text that arrives in a URL, i.e. text
   anyone can write. So nothing here ever goes through innerHTML: every
   piece of text becomes a text node, raw HTML is shown as text, and link /
   image addresses are filtered (no javascript:, no unknown schemes; images
   only from http(s), relative paths, or base64 png/jpeg/gif/webp).
   ========================================================================== */

const Markdown = (function () {
  const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

  const RE = {
    blank: /^\s*$/,
    heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
    fence: /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/,
    hr: /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/,
    quote: /^ {0,3}> ?(.*)$/,
    list: /^( {0,3})([-*+]|(\d{1,9})([.)]))(?:([ \t]+)(.*))?$/,
    setext: /^ {0,3}(=+|-+)[ \t]*$/,
    indentedCode: /^( {4}|\t)/,
    tableDelim: /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
  };

  /* --------------------------------- Blocks --------------------------------- */

  function leadingSpaces(line) {
    const m = /^ */.exec(line);
    return m ? m[0].length : 0;
  }

  function isTableStart(lines, i) {
    return i + 1 < lines.length && lines[i].indexOf('|') !== -1 &&
      RE.tableDelim.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1 &&
      splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
  }

  // Lines that end a paragraph without needing a blank line before them.
  function interruptsParagraph(line) {
    if (RE.heading.test(line) || RE.fence.test(line) || RE.hr.test(line) || RE.quote.test(line)) return true;
    const m = RE.list.exec(line);
    if (m && m[6] && m[6].trim()) {
      return !m[3] || m[3] === '1'; // a numbered list only interrupts when it starts at 1
    }
    return false;
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    let inCode = false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charAt(i);
      if (c === '\\' && s.charAt(i + 1) === '|') { cur += '|'; i++; continue; }
      if (c === '`') inCode = !inCode;
      if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseBlocks(lines) {
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (RE.blank.test(line)) { i++; continue; }

      // fenced code
      let m = RE.fence.exec(line);
      if (m) {
        const indent = m[1].length;
        const fenceChar = m[2].charAt(0);
        const fenceLen = m[2].length;
        const lang = m[3] || '';
        const code = [];
        i++;
        while (i < lines.length) {
          const close = new RegExp('^ {0,3}' + (fenceChar === '`' ? '`' : '~') + '{' + fenceLen + ',}[ \\t]*$');
          if (close.test(lines[i])) { i++; break; }
          code.push(lines[i].slice(Math.min(indent, leadingSpaces(lines[i]))));
          i++;
        }
        blocks.push({ type: 'code', lang: lang, text: code.join('\n') });
        continue;
      }

      // indented code (only at the start of a block, never inside a paragraph)
      if (RE.indentedCode.test(line)) {
        const code = [];
        while (i < lines.length && (RE.indentedCode.test(lines[i]) || RE.blank.test(lines[i]))) {
          code.push(lines[i].replace(RE.indentedCode, ''));
          i++;
        }
        while (code.length && RE.blank.test(code[code.length - 1])) code.pop();
        blocks.push({ type: 'code', lang: '', text: code.join('\n') });
        continue;
      }

      m = RE.heading.exec(line);
      if (m) {
        blocks.push({ type: 'heading', level: m[1].length, text: (m[2] || '').trim() });
        i++;
        continue;
      }

      if (RE.hr.test(line)) {
        blocks.push({ type: 'hr' });
        i++;
        continue;
      }

      if (RE.quote.test(line)) {
        const inner = [];
        while (i < lines.length) {
          const q = RE.quote.exec(lines[i]);
          if (q) { inner.push(q[1]); i++; continue; }
          if (RE.blank.test(lines[i])) break;
          // "lazy" continuation of a paragraph inside the quote
          if (inner.length && !RE.blank.test(inner[inner.length - 1]) && !interruptsParagraph(lines[i])) {
            inner.push(lines[i]);
            i++;
            continue;
          }
          break;
        }
        blocks.push({ type: 'quote', children: parseBlocks(inner) });
        continue;
      }

      m = RE.list.exec(line);
      if (m) {
        const res = parseList(lines, i);
        blocks.push(res.block);
        i = res.next;
        continue;
      }

      if (isTableStart(lines, i)) {
        const head = splitRow(lines[i]);
        const align = splitRow(lines[i + 1]).map((c) => {
          const left = c.charAt(0) === ':';
          const right = c.charAt(c.length - 1) === ':';
          return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
        });
        const rows = [];
        i += 2;
        while (i < lines.length && !RE.blank.test(lines[i]) && lines[i].indexOf('|') !== -1 && !interruptsParagraph(lines[i])) {
          const cells = splitRow(lines[i]);
          while (cells.length < head.length) cells.push('');
          rows.push(cells.slice(0, head.length));
          i++;
        }
        blocks.push({ type: 'table', head: head, align: align, rows: rows });
        continue;
      }

      // paragraph (possibly a setext heading)
      const para = [line];
      i++;
      let setextLevel = 0;
      while (i < lines.length && !RE.blank.test(lines[i])) {
        const s = RE.setext.exec(lines[i]);
        if (s) { setextLevel = s[1].charAt(0) === '=' ? 1 : 2; i++; break; }
        if (interruptsParagraph(lines[i]) || isTableStart(lines, i)) break;
        para.push(lines[i]);
        i++;
      }
      if (setextLevel) blocks.push({ type: 'heading', level: setextLevel, text: para.join(' ').trim() });
      else blocks.push({ type: 'para', text: para.map((l) => l.replace(/^ {1,3}/, '')).join('\n') });
    }

    return blocks;
  }

  function parseList(lines, start) {
    const first = RE.list.exec(lines[start]);
    const ordered = !!first[3];
    const markerType = ordered ? first[4] : first[2];
    const items = [];
    let loose = false;
    let i = start;

    while (i < lines.length) {
      const m = RE.list.exec(lines[i]);
      if (!m) break;
      const isOrdered = !!m[3];
      if (isOrdered !== ordered || (ordered ? m[4] : m[2]) !== markerType) break;

      const indent = m[1].length;
      const marker = m[2];
      const spaces = m[5] ? m[5].replace(/\t/g, '    ').length : 1;
      const contentIndent = indent + marker.length + (spaces > 4 ? 1 : spaces);
      const itemLines = [m[6] || ''];
      i++;

      let sawBlank = false;
      while (i < lines.length) {
        const l = lines[i];
        if (RE.blank.test(l)) { itemLines.push(''); sawBlank = true; i++; continue; }
        const lead = leadingSpaces(l.replace(/\t/g, '    '));
        if (lead >= contentIndent) {
          itemLines.push(l.replace(/\t/g, '    ').slice(contentIndent));
          sawBlank = false;
          i++;
          continue;
        }
        if (sawBlank) break;
        // lazy continuation of the item's paragraph
        const lastLine = itemLines[itemLines.length - 1];
        if (!RE.list.test(l) && !interruptsParagraph(l) && lastLine && !RE.blank.test(lastLine)) {
          itemLines.push(l.trim());
          i++;
          continue;
        }
        break;
      }

      let trailingBlank = false;
      while (itemLines.length && RE.blank.test(itemLines[itemLines.length - 1])) { itemLines.pop(); trailingBlank = true; }
      // a blank line between two paragraphs of the same item also makes it loose
      for (let k = 1; k < itemLines.length - 1; k++) {
        if (RE.blank.test(itemLines[k]) && !RE.blank.test(itemLines[k - 1]) && !RE.list.test(itemLines[k + 1]) && leadingSpaces(itemLines[k + 1]) === 0) loose = true;
      }

      let task = null;
      const tm = /^\[([ xX])\][ \t]+/.exec(itemLines[0]);
      if (tm) {
        task = tm[1] !== ' ';
        itemLines[0] = itemLines[0].slice(tm[0].length);
      }

      items.push({ task: task, children: parseBlocks(itemLines) });

      const next = RE.list.exec(lines[i] || '');
      if (trailingBlank && next) loose = true;
    }

    return {
      block: { type: 'list', ordered: ordered, start: ordered ? parseInt(first[3], 10) : 1, loose: loose, items: items },
      next: i
    };
  }

  /* --------------------------------- Inline --------------------------------- */

  const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0', copy: '©', reg: '®', trade: '™',
    hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    times: '×', middot: '·', bull: '•', deg: '°', shy: '\u00AD', zwj: '\u200D', zwnj: '\u200C'
  };

  function decodeEntities(s) {
    return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+[0-9]*);/gi, (all, name) => {
      if (name.charAt(0) === '#') {
        const code = name.charAt(1).toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        if (code > 0 && code < 0x110000 && !(code >= 0xD800 && code <= 0xDFFF)) return String.fromCodePoint(code);
        return all;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, name.toLowerCase()) ? ENTITIES[name.toLowerCase()] : all;
    });
  }

  function hasScheme(u) { return /^[a-z][a-z0-9+.\-]*:/i.test(u); }

  function safeHref(url) {
    const u = String(url || '').trim();
    if (!u) return null;
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (hasScheme(u)) return null;
    return u;
  }

  function safeImageSrc(url) {
    const u = String(url || '').trim();
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u;
    if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(u)) return u;
    if (!hasScheme(u) && u.slice(0, 2) !== '//') return u;
    return null;
  }

  // Index just past a code span starting at i, or -1.
  function codeSpanEnd(text, i) {
    let k = 0;
    while (text.charAt(i + k) === '`') k++;
    const fence = '`'.repeat(k);
    let p = i + k;
    while (p < text.length) {
      const j = text.indexOf(fence, p);
      if (j === -1) return -1;
      if (text.charAt(j + k) !== '`' && text.charAt(j - 1) !== '`') return j + k;
      p = j + 1;
      while (text.charAt(p) === '`') p++;
    }
    return -1;
  }

  // [label](destination "title") starting at text[i] === '['.
  function parseLinkLike(text, i) {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text.charAt(j);
      if (c === '\\') { j++; continue; }
      if (c === '`') { const e = codeSpanEnd(text, j); if (e !== -1) { j = e - 1; continue; } }
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0 || text.charAt(j + 1) !== '(') return null;
    const label = text.slice(i + 1, j);
    let p = j + 2;
    while (/[ \t\n]/.test(text.charAt(p))) p++;
    let dest = '';
    if (text.charAt(p) === '<') {
      const close = text.indexOf('>', p);
      if (close === -1) return null;
      dest = text.slice(p + 1, close);
      p = close + 1;
    } else {
      let parens = 0;
      const startDest = p;
      for (; p < text.length; p++) {
        const c = text.charAt(p);
        if (c === '\\') { p++; continue; }
        if (/\s/.test(c)) break;
        if (c === '(') parens++;
        else if (c === ')') { if (parens === 0) break; parens--; }
      }
      dest = text.slice(startDest, p);
    }
    while (/[ \t\n]/.test(text.charAt(p))) p++;
    let title = '';
    const q = text.charAt(p);
    if (q === '"' || q === "'" || q === '(') {
      const closeChar = q === '(' ? ')' : q;
      const close = text.indexOf(closeChar, p + 1);
      if (close === -1) return null;
      title = text.slice(p + 1, close);
      p = close + 1;
      while (/[ \t\n]/.test(text.charAt(p))) p++;
    }
    if (text.charAt(p) !== ')') return null;
    return { label: label, dest: dest.replace(/\\([^\w\s])/g, '$1'), title: title, end: p + 1 };
  }

  // Closing delimiter for emphasis, skipping code spans; -1 if none.
  function findClosing(text, from, delim) {
    const ch = delim.charAt(0);
    for (let p = from; p < text.length; p++) {
      const c = text.charAt(p);
      if (c === '\\') { p++; continue; }
      if (c === '`') { const e = codeSpanEnd(text, p); if (e !== -1) { p = e - 1; continue; } }
      if (text.startsWith(delim, p) && p > from && !/\s/.test(text.charAt(p - 1))) {
        // for "_", the closing run must not be followed by a letter or digit (snake_case)
        if (ch === '_' && /[A-Za-z0-9]/.test(text.charAt(p + delim.length))) continue;
        // "*" closing exactly: don't take the first star of a longer run meant for something else
        if (delim.length === 1 && text.charAt(p + 1) === ch && text.charAt(p - 1) !== ch) { p++; continue; }
        return p;
      }
    }
    return -1;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => { if (attrs[k] != null) node.setAttribute(k, attrs[k]); });
    (children || []).forEach((c) => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function inline(text, opts) {
    const out = document.createDocumentFragment();
    let buf = '';
    const flush = () => {
      if (buf) { out.appendChild(document.createTextNode(decodeEntities(buf))); buf = ''; }
    };
    const len = text.length;
    let i = 0;

    while (i < len) {
      const c = text.charAt(i);

      if (c === '\\' && i + 1 < len) {
        const n = text.charAt(i + 1);
        if (n === '\n') { buf = buf.replace(/ +$/, ''); flush(); out.appendChild(el('br')); i += 2; continue; }
        if (PUNCT.test(n)) { buf += n; i += 2; continue; }
      }

      if (c === '`') {
        const end = codeSpanEnd(text, i);
        let k = 0;
        while (text.charAt(i + k) === '`') k++;
        if (end === -1) { buf += '`'.repeat(k); i += k; continue; }
        let code = text.slice(i + k, end - k).replace(/\n/g, ' ');
        if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
        flush();
        out.appendChild(el('code', null, [code]));
        i = end;
        continue;
      }

      if (c === '!' && text.charAt(i + 1) === '[') {
        const r = parseLinkLike(text, i + 1);
        if (r) {
          flush();
          const src = safeImageSrc(r.dest);
          const alt = decodeEntities(r.label.replace(/\\([^\w\s])/g, '$1'));
          if (src) out.appendChild(el('img', { src: src, alt: alt, title: r.title || null }));
          else out.appendChild(document.createTextNode('[image: ' + (alt || 'not shown') + ']'));
          i = r.end;
          continue;
        }
      }

      if (c === '[') {
        const r = parseLinkLike(text, i);
        if (r) {
          flush();
          const href = safeHref(r.dest);
          const content = inline(r.label, opts);
          if (href) {
            const a = el('a', { href: href, title: r.title || null });
            if (opts.linkTarget && href.charAt(0) !== '#') { a.target = opts.linkTarget; a.rel = 'noopener noreferrer'; }
            a.appendChild(content);
            out.appendChild(a);
          } else {
            out.appendChild(content);
          }
          i = r.end;
          continue;
        }
      }

      if (c === '<') {
        const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(i));
        if (m) {
          flush();
          const a = el('a', { href: m[1] }, [m[1].replace(/^mailto:/i, '')]);
          if (opts.linkTarget) { a.target = opts.linkTarget; a.rel = 'noopener noreferrer'; }
          out.appendChild(a);
          i += m[0].length;
          continue;
        }
        const mail = /^<([^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,})>/i.exec(text.slice(i));
        if (mail) {
          flush();
          out.appendChild(el('a', { href: 'mailto:' + mail[1] }, [mail[1]]));
          i += mail[0].length;
          continue;
        }
        const br = /^<br\s*\/?>/i.exec(text.slice(i));
        if (br) { flush(); out.appendChild(el('br')); i += br[0].length; continue; }
        // a few harmless inline tags GitHub also renders; any other HTML stays text
        const tag = /^<(sub|sup|kbd)>/i.exec(text.slice(i));
        if (tag) {
          const name = tag[1].toLowerCase();
          const close = text.toLowerCase().indexOf('</' + name + '>', i + tag[0].length);
          if (close !== -1) {
            flush();
            const node = el(name);
            node.appendChild(inline(text.slice(i + tag[0].length, close), opts));
            out.appendChild(node);
            i = close + name.length + 3;
            continue;
          }
        }
      }

      if (c === 'h' && (i === 0 || /[\s(]/.test(text.charAt(i - 1))) && /^https?:\/\//.test(text.slice(i, i + 8))) {
        const m = /^https?:\/\/[^\s<]+/.exec(text.slice(i));
        let url = m[0];
        url = url.replace(/[?!.,:;*_~'"]+$/, '');
        // drop an unbalanced closing parenthesis, e.g. "(see https://x.y/z)"
        while (url.slice(-1) === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
        if (url.length > 8) {
          flush();
          const a = el('a', { href: url }, [url]);
          if (opts.linkTarget) { a.target = opts.linkTarget; a.rel = 'noopener noreferrer'; }
          out.appendChild(a);
          i += url.length;
          continue;
        }
      }

      if (c === '*' || c === '_' || c === '~') {
        let k = 0;
        while (text.charAt(i + k) === c) k++;
        const prev = i > 0 ? text.charAt(i - 1) : ' ';
        const next = text.charAt(i + k) || ' ';
        const intraword = c === '_' && /[A-Za-z0-9]/.test(prev);
        if (/\s/.test(next) || intraword || (c === '~' && k !== 2)) { buf += c.repeat(k); i += k; continue; }

        const tries = c === '~' ? [['~~', 'del']] : k >= 3
          ? [[c.repeat(3), 'strong+em'], [c + c, 'strong'], [c, 'em']]
          : k === 2 ? [[c + c, 'strong'], [c, 'em']] : [[c, 'em']];
        let done = false;
        for (const t of tries) {
          const delim = t[0];
          const close = findClosing(text, i + delim.length, delim);
          if (close === -1) continue;
          flush();
          const inner = inline(text.slice(i + delim.length, close), opts);
          let node;
          if (t[1] === 'strong+em') { node = el('strong'); const em = el('em'); em.appendChild(inner); node.appendChild(em); }
          else { node = el(t[1]); node.appendChild(inner); }
          // a leftover delimiter (e.g. "**text*") stays literal
          if (delim.length < k && t[1] !== 'strong+em') buf += c.repeat(k - delim.length);
          flush();
          out.appendChild(node);
          i = close + delim.length;
          done = true;
          break;
        }
        if (!done) { buf += c.repeat(k); i += k; }
        continue;
      }

      if (c === '\n') {
        const hard = /  +$/.test(buf);
        buf = buf.replace(/ +$/, '');
        if (hard || opts.breaks) { flush(); out.appendChild(el('br')); }
        else buf += ' ';
        i++;
        continue;
      }

      buf += c;
      i++;
    }

    flush();
    return out;
  }

  /* -------------------------------- Rendering -------------------------------- */

  function slug(text) {
    return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
  }

  function renderBlocks(blocks, opts, parent, tight) {
    blocks.forEach((b) => {
      if (b.type === 'heading') {
        const level = Math.min(6, b.level + (opts.headingOffset || 0));
        const h = el('h' + level);
        if (opts.idPrefix) h.id = opts.idPrefix + slug(b.text);
        h.appendChild(inline(b.text, opts));
        parent.appendChild(h);
      } else if (b.type === 'para') {
        if (tight) parent.appendChild(inline(b.text, opts));
        else { const p = el('p'); p.appendChild(inline(b.text, opts)); parent.appendChild(p); }
      } else if (b.type === 'code') {
        const code = el('code', b.lang ? { class: 'language-' + b.lang.replace(/[^\w-]/g, '') } : null, [b.text]);
        parent.appendChild(el('pre', null, [code]));
      } else if (b.type === 'hr') {
        parent.appendChild(el('hr'));
      } else if (b.type === 'quote') {
        const q = el('blockquote');
        renderBlocks(b.children, opts, q, false);
        parent.appendChild(q);
      } else if (b.type === 'list') {
        const list = el(b.ordered ? 'ol' : 'ul');
        if (b.ordered && b.start !== 1) list.setAttribute('start', String(b.start));
        if (b.items.some((it) => it.task !== null)) list.className = 'contains-task-list';
        b.items.forEach((it) => {
          const li = el('li');
          if (it.task !== null) {
            li.className = 'task-list-item';
            const box = el('input', { type: 'checkbox', disabled: '' });
            box.checked = it.task;
            li.appendChild(box);
            li.appendChild(document.createTextNode(' '));
          }
          renderBlocks(it.children, opts, li, !b.loose);
          list.appendChild(li);
        });
        parent.appendChild(list);
      } else if (b.type === 'table') {
        const table = el('table');
        const thead = el('thead');
        const htr = el('tr');
        b.head.forEach((cell, k) => {
          const th = el('th');
          if (b.align[k]) th.style.textAlign = b.align[k];
          th.appendChild(inline(cell, opts));
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);
        const tbody = el('tbody');
        b.rows.forEach((row) => {
          const tr = el('tr');
          row.forEach((cell, k) => {
            const td = el('td');
            if (b.align[k]) td.style.textAlign = b.align[k];
            td.appendChild(inline(cell, opts));
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        parent.appendChild(el('div', { class: 'md-table-wrap' }, [table]));
      }
    });
  }

  function toLines(markdown) {
    return String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
  }

  /**
   * Markdown string → DocumentFragment.
   * opts.breaks        single newlines become <br>, like GitHub comments do
   * opts.linkTarget    e.g. '_blank' for external links
   * opts.headingOffset shift heading levels (1 → h1+offset)
   * opts.idPrefix      give headings ids (prefix + slug) for in-page anchors
   * opts.dropTitle     drop a first "# Heading" whose text equals this
   */
  function render(markdown, opts) {
    opts = opts || {};
    let blocks = parseBlocks(toLines(markdown));
    if (opts.dropTitle && blocks.length && blocks[0].type === 'heading' && blocks[0].level === 1 &&
        blocks[0].text.trim().toLowerCase() === String(opts.dropTitle).trim().toLowerCase()) {
      blocks = blocks.slice(1);
    }
    const frag = document.createDocumentFragment();
    renderBlocks(blocks, opts, frag, false);
    return frag;
  }

  function renderInline(text, opts) {
    return inline(String(text == null ? '' : text), opts || {});
  }

  return {
    render: render,
    renderInline: renderInline,
    parseBlocks: (md) => parseBlocks(toLines(md)),
    safeHref: safeHref,
    safeImageSrc: safeImageSrc,
    slug: slug
  };
})();
