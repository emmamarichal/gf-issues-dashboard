// Minimal stand-in for the dashboard runtime the page was first written for:
// loads the data files built by the GitHub Action, computes the page's calculations,
// and adds a live layer that asks GitHub which issues changed since that build.
(function () {
  const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const FILES = { issues: 'data/issues_triage.json', close: 'data/close_candidates.json' };
  const datasets = {};
  const calcs = {};
  const callbacks = [];

  const dash = {
    get colors() {
      const t = document.documentElement.getAttribute('data-theme');
      return t === 'dark' || (t !== 'light' && dark.matches) ? DARK : LIGHT;
    },
    calc(id, o) { calcs[id] = o; },
    data(id) {
      const c = calcs[id];
      if (c) {
        const ins = c.inputs.map((i) => dash.data(i));
        const bad = ins.find((x) => x.status !== 'ok');
        if (bad) return { status: bad.status, data: [] };
        if (!('_v' in c)) c._v = c.fn(...ins.map((x) => x.data));
        return { status: 'ok', data: c._v };
      }
      return datasets[id] || { status: 'loading', data: [] };
    },
    onData(fn) { callbacks.push(fn); run(fn); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ } },
    params: () => ({}), setParams() {}, resetParams() {}, refresh() {},
  };
  window.dash = dash;

  function run(fn) { try { fn(); } catch (e) { console.error(e); } }
  function fire() {
    Object.values(calcs).forEach((c) => { delete c._v; });
    callbacks.forEach(run);
  }

  function el(tag, text, attrs) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }

  async function liveLayer(meta) {
    const box = document.getElementById('live');
    if (!box || !meta.built) return;
    box.hidden = false;
    box.textContent = 'Checking GitHub for changes since the last full analysis…';
    const changed = [];
    try {
      for (let page = 1; page <= 3; page++) {
        const r = await fetch(`https://api.github.com/repos/google/fonts/issues?state=all&since=${encodeURIComponent(meta.built)}&per_page=100&page=${page}`,
          { headers: { Accept: 'application/vnd.github+json' } });
        if (!r.ok) throw new Error(r.status === 403 ? 'GitHub rate limit reached for this network' : 'HTTP ' + r.status);
        const batch = await r.json();
        changed.push(...batch.filter((x) => !x.pull_request));
        if (batch.length < 100) break;
      }
    } catch (e) {
      box.replaceChildren(el('b', 'Live check unavailable: '), String(e.message || e));
      return;
    }
    const known = new Set((datasets.issues.data || []).map((r) => r.number));
    const closed = new Set(changed.filter((x) => x.state === 'closed' && known.has(x.number)).map((x) => x.number));
    const fresh = changed.filter((x) => x.state === 'open' && !known.has(x.number));
    if (closed.size) {
      datasets.issues.data = datasets.issues.data.filter((r) => !closed.has(r.number));
      datasets.close.data = datasets.close.data.filter((r) => !closed.has(r.number));
      fire();
    }
    const when = new Date(meta.built).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    box.replaceChildren(el('b', 'Live: '),
      `${closed.size} issue(s) closed since the full analysis of ${when} (already removed from the figures), ${fresh.length} new open issue(s) not classified yet.`);
    if (fresh.length) {
      const ul = el('ul');
      fresh.slice(0, 10).forEach((x) => {
        const li = el('li');
        const a = el('a', `#${x.number} ${x.title}`, { href: x.html_url, target: '_blank', rel: 'noopener' });
        li.append(a);
        ul.append(li);
      });
      box.append(ul);
    }
  }

  async function load() {
    let meta = {};
    try { meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json(); } catch (e) { /* no meta */ }
    await Promise.all(Object.entries(FILES).map(async ([id, url]) => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        datasets[id] = { status: 'ok', data, columns: data.length ? Object.keys(data[0]) : [] };
      } catch (e) {
        datasets[id] = { status: 'error', data: [], message: String(e) };
      }
    }));
    fire();
    const note = document.getElementById('gen-note');
    if (note && meta.built) {
      note.textContent = 'Full analysis: ' + new Date(meta.built).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + ' · hourly';
      if (/^https:\/\//.test(meta.update_url || '')) {
        note.append(' · ');
        note.append(el('a', 'Run an update now ↗', { href: meta.update_url, target: '_blank', rel: 'noopener' }));
      }
    }
    if (datasets.issues && datasets.issues.status === 'ok') liveLayer(meta);
  }

  let width = window.innerWidth;
  window.addEventListener('resize', () => { if (window.innerWidth !== width) { width = window.innerWidth; fire(); } });
  dark.addEventListener('change', fire);
  window.addEventListener('DOMContentLoaded', load);
})();
