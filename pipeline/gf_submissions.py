#!/usr/bin/env python3
"""
Google Fonts "Submissions to review" report.

Builds one self-contained HTML page with a card per open issue that has the
"II Submission" label and sits in the "Submissions to review" milestone.

Everything this tool does on GitHub is READ-ONLY (GET requests through the
`gh` CLI, and `git clone`). It never comments, labels, assigns or opens PRs.

Usage
  python gf_submissions.py serve        # local page with a "Generate" button
                                        # at http://127.0.0.1:8765
  python gf_submissions.py generate     # build the report once and open it

Options
  --jobs N            repos analysed in parallel (default 4)
  --checker X         auto | fontspector | fontbakery | none  (default auto)
  --cache DIR         clones and cached results (default ~/.cache/gf-submissions)
  --out FILE          report path (default <cache>/submissions_report.html)
  --issues-json FILE  offline mode: take issues from a `gh api .../issues` export
                      instead of GitHub (no comments, profiles or repo metadata)
  --no-open           don't open the browser

Needs: git, gh (logged in), python3 with fonttools, glyphsets, gflanguages
(pip install fonttools glyphsets gflanguages brotli). fontspector or
fontbakery for the QA column (optional).
"""
import argparse, base64, collections, concurrent.futures as cf, datetime as dt, hashlib, html, io, json, math
import os, re, shutil, subprocess, sys, threading, time, traceback, urllib.parse, webbrowser

REPO = "google/fonts"
TEMPLATE = None
LABEL = "II Submission"
MILESTONE = "Submissions to review"
NOW = dt.datetime.now(dt.timezone.utc)
LOG = []
LOG_LOCK = threading.Lock()


def log(msg):
    line = f"{dt.datetime.now().strftime('%H:%M:%S')}  {msg}"
    with LOG_LOCK:
        LOG.append(line)
    print(line, flush=True)


# ----------------------------------------------------------------- GitHub (read only)
def gh_get(path, paginate=False, **params):
    """GET through the gh CLI. Returns parsed JSON or None."""
    args = ["gh", "api", "-X", "GET", "-H", "Accept: application/vnd.github+json", path]
    if paginate:
        args.insert(2, "--paginate")
    for k, v in params.items():
        args += ["-f", f"{k}={v}"]
    for attempt in range(4):
        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode == 0:
            txt = p.stdout.strip()
            if paginate:
                txt = txt.replace("]\n[", ",").replace("][", ",")
            return json.loads(txt) if txt else None
        if "rate limit" in p.stderr.lower() or "secondary" in p.stderr.lower():
            time.sleep(20 * (attempt + 1))
            continue
        if attempt == 3 or "Not Found" in p.stderr:
            log(f"gh: {path} failed: {p.stderr.strip()[:160]}")
            return None
        time.sleep(3)
    return None


def fetch_submissions():
    ms = gh_get(f"repos/{REPO}/milestones", paginate=True, state="open", per_page="100") or []
    m = next((m for m in ms if m["title"].strip().lower() == MILESTONE.lower()), None)
    if not m:
        raise SystemExit(f'Milestone "{MILESTONE}" not found (is gh logged in?)')
    items = gh_get(f"repos/{REPO}/issues", paginate=True, state="open", labels=LABEL,
                   milestone=str(m["number"]), per_page="100") or []
    return [i for i in items if "pull_request" not in i], m


def load_offline(path):
    txt = open(path).read().strip().replace("]\n[", ",").replace("][", ",")
    items = json.loads(txt)
    return [i for i in items if "pull_request" not in i and i.get("state", "open") == "open"
            and any(l["name"] == LABEL for l in i["labels"])
            and (i.get("milestone") or {}).get("title") == MILESTONE]


class Cache:
    def __init__(self, root):
        self.root = root
        os.makedirs(os.path.join(root, "json"), exist_ok=True)

    def get(self, key, max_age_h):
        p = os.path.join(self.root, "json", hashlib.sha1(key.encode()).hexdigest() + ".json")
        if os.path.exists(p) and time.time() - os.path.getmtime(p) < max_age_h * 3600:
            return json.load(open(p))
        return None

    def put(self, key, value):
        p = os.path.join(self.root, "json", hashlib.sha1(key.encode()).hexdigest() + ".json")
        json.dump(value, open(p, "w"))
        return value


SEARCH_LOCK = threading.Lock()


def submitter_profile(login, cache):
    hit = cache.get("user:" + login, 24)
    if hit is not None:
        return hit
    u = gh_get(f"users/{login}") or {}
    orgs = gh_get(f"users/{login}/orgs") or []
    with SEARCH_LOCK:  # search API: 30 requests / minute
        time.sleep(2.2)
        s = gh_get("search/issues", q=f"repo:{REPO} author:{login}", per_page="100") or {}
    hist = []
    for it in s.get("items", []):
        labels = [l["name"] for l in it.get("labels", [])]
        hist.append({"number": it["number"], "title": it["title"], "state": it["state"],
                     "is_pr": "pull_request" in it, "labels": labels, "url": it["html_url"],
                     "created": it["created_at"][:10]})
    prof = {
        "login": login, "name": u.get("name") or "", "type": u.get("type"), "created": (u.get("created_at") or "")[:10],
        "public_repos": u.get("public_repos"), "followers": u.get("followers"),
        "company": u.get("company") or "", "blog": u.get("blog") or "",
        "orgs": [o["login"] for o in orgs], "gf_total": s.get("total_count", 0), "gf_items": hist,
    }
    return cache.put("user:" + login, prof)


# ----------------------------------------------------------------- repo
EXCLUDE_OWNERS = {"google", "googlefonts", "fonttools", "user-attachments", "orgs", "settings", "notofonts",
                  "github", "jetbrains", "ibm", "adobe-fonts", "googlei18n", "topics", "features", "marketplace"}
REPO_URL = re.compile(r"https?://(?:www\.)?(github\.com|gitlab\.com|codeberg\.org)/([\w.-]+)/([\w.-]+)", re.I)


def family_from_title(title):
    t = re.sub(r"^\s*\W*(add(ing)?|submit(ting)?|submission( of)?|new font|font submission|onboard|please add)\b\W*",
               "", title, flags=re.I)
    t = re.split(r"\s+[—–(\-:|]\s*|\s+v?\d+\.\d+", t)[0]
    t = re.sub(r"\b(font|fonts|family|typeface)\b", "", t, flags=re.I)
    return t.strip(" .:-") or title


def find_repo(body, title):
    body = body or ""
    cands = []
    m = re.search(r"Font Project Git Repo URL:?\**\s*(?:\n\s*)*<?(https?://[^\s>)\]]+)", body, re.I)
    if m:
        cands.append(m.group(1))
    cands += [m.group(0) for m in REPO_URL.finditer(body)]
    fam = re.sub(r"[^a-z0-9]", "", family_from_title(title).lower())
    best, best_score = None, -1
    for k, url in enumerate(cands):
        mm = REPO_URL.match(url)
        if not mm:
            continue
        host, owner, name = mm.group(1).lower(), mm.group(2), re.sub(r"\.git$", "", mm.group(3)).rstrip(".")
        if owner.lower() in EXCLUDE_OWNERS:
            continue
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        score = (3 if k == 0 and m else 0) + (4 if fam and (fam in key or key in fam) else 0) \
            - (2 if name.lower().endswith(".github.io") else 0)
        if score > best_score:
            best, best_score = (host, owner, name), score
    if not best:
        return None
    host, owner, name = best
    return {"host": host, "owner": owner, "name": name, "url": f"https://{host}/{owner}/{name}"}


def git(d, *a, timeout=600):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LFS_SKIP_SMUDGE="1")
    return subprocess.run(["git", "-C", d, *a], check=True, capture_output=True, timeout=timeout, env=env)


def clone(repo, cache_root):
    """Blobless, no-checkout clone: only the file list is downloaded; files are fetched on demand."""
    d = os.path.join(cache_root, "repos", f"{repo['host']}__{repo['owner']}__{repo['name']}".lower())
    try:
        if os.path.isdir(os.path.join(d, ".git")):
            git(d, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", "HEAD")
            git(d, "update-ref", "HEAD", "FETCH_HEAD")
        else:
            os.makedirs(d, exist_ok=True)
            git(d, "init", "-q")
            git(d, "remote", "add", "origin", repo["url"] + ".git")
            git(d, "fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", "HEAD", timeout=900)
            git(d, "update-ref", "HEAD", "FETCH_HEAD")
        out = git(d, "log", "-1", "--format=%H%x09%cI%x09%s").stdout.decode(errors="replace").strip().split("\t")
        return d, {"sha": out[0], "date": out[1][:10] if len(out) > 1 else "", "msg": out[2] if len(out) > 2 else ""}
    except subprocess.CalledProcessError as e:
        return None, {"error": (e.stderr or b"").decode(errors="replace").strip()[:200] or "git failed"}
    except subprocess.TimeoutExpired:
        return None, {"error": "clone timed out"}


def materialize(d, paths):
    """Fetch and write only these files into the work tree."""
    paths = [p for p in paths if p]
    for k in range(0, len(paths), 50):
        try:
            git(d, "checkout", "-q", "HEAD", "--", *paths[k:k + 50], timeout=900)
        except subprocess.CalledProcessError as e:
            log(f"checkout failed in {os.path.basename(d)}: {(e.stderr or b'').decode(errors='replace')[:120]}")


SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "__pycache__", "build", "dist"}


def tree_paths(d):
    """All paths of HEAD, with .ufo / .glyphspackage folders collapsed to one entry."""
    raw = git(d, "ls-tree", "-r", "--name-only", "-z", "HEAD").stdout.decode(errors="replace").split("\0")
    out, seen = [], set()
    for p in raw:
        if not p or any(part in SKIP_DIRS for part in p.split("/")):
            continue
        m = re.match(r"(.*?\.(?:ufo|ufoz|glyphspackage))(/|$)", p, re.I)
        if m:
            if m.group(1) not in seen:
                seen.add(m.group(1)); out.append(m.group(1))
            continue
        out.append(p)
    return out


SOURCE_KINDS = [  # (label, test, points)
    ("Glyphs (.glyphs / .glyphspackage)", lambda p: p.endswith((".glyphs", ".glyphspackage")), 15),
    ("Designspace + UFO", lambda p: p.endswith(".designspace"), 15),
    ("UFO", lambda p: p.endswith((".ufo", ".ufoz")), 13),
    ("Fontra / Babelfont", lambda p: p.endswith((".fontra", ".babelfont")), 12),
    ("FontLab (.vfc / .vfj)", lambda p: p.endswith((".vfc", ".vfj")), 10),
    ("FontForge (.sfd)", lambda p: p.endswith(".sfd"), 8),
    ("Generator scripts (.py)", lambda p: "/generator" in "/" + p or (p.startswith("sources/") and p.endswith(".py")), 6),
]


def inspect_repo(d):
    paths = tree_paths(d)
    low = {p.lower(): p for p in paths}
    src = collections.OrderedDict()
    for label, test, pts in SOURCE_KINDS:
        hits = [p for p in paths if test(p.lower())]
        if hits:
            src[label] = {"points": pts, "files": hits[:6], "count": len(hits)}
    template = {
        "Makefile": "makefile" in low,
        "requirements": any(k in low for k in ("requirements.txt", "requirements.in")),
        "sources/config.yaml": any(k in low for k in ("sources/config.yaml", "sources/config.yml")),
        "OFL.txt": "ofl.txt" in low,
        "documentation/": any(p.lower().startswith("documentation/") for p in paths),
        "CI workflow": any(p.lower().startswith(".github/workflows/") for p in paths),
    }
    lic_path = next((low[k] for k in ("ofl.txt", "license.txt", "license", "license.md", "ofl.md") if k in low), None)
    readme = next((low[k] for k in ("readme.md", "readme.txt", "readme", "readme.rst") if k in low), None)
    docs = [p for p in paths if re.search(r"(description|fontlog|article)[^/]*\.(html|md|txt)$", p.lower())][:4]
    fonts = [p for p in paths if p.lower().endswith((".ttf", ".otf")) and not re.search(
        r"(^|/)(sources?|tests?|old|archive|legacy|proofs?|specimen|node_modules)/", p.lower())]
    groups = [
        [p for p in fonts if "/variable/" in "/" + p.lower() or "[" in p],
        [p for p in fonts if p.lower().startswith("fonts/ttf/") or "/ttf/" in p.lower()],
        [p for p in fonts if p.lower().startswith("fonts/")],
        fonts,
    ]
    chosen = next((g for g in groups if g), [])
    if chosen and any(x.lower().endswith(".ttf") for x in chosen):
        chosen = [x for x in chosen if x.lower().endswith(".ttf")]
    chosen = sorted(chosen)[:20]
    materialize(d, [lic_path, readme] + docs + chosen)
    lic = {"file": lic_path, "ofl11": False, "rfn": [], "copyright": ""}
    if lic_path and os.path.exists(os.path.join(d, lic_path)):
        t = open(os.path.join(d, lic_path), errors="replace").read()
        lic["ofl11"] = bool(re.search(r"SIL OPEN FONT LICEN[SC]E,?\s*Version 1\.1", t, re.I))
        lic["rfn"] = sorted({x.strip(" .,\"'“”") for x in re.findall(
            r"with\s+Reserved\s+Font\s+Names?\s*[\"“']([^\"”'\n]+)[\"”']", t, re.I)})
        c = re.search(r"^.*Copyright.*$", t, re.M)
        lic["copyright"] = c.group(0).strip()[:200] if c else ""
    texts = ""
    for p in [readme] + docs:
        if p and os.path.exists(os.path.join(d, p)):
            texts += "\n" + open(os.path.join(d, p), errors="replace").read()[:20000]
    chosen = [p for p in chosen if os.path.exists(os.path.join(d, p))]
    return {"sources": src, "template": template, "license": lic, "fonts": chosen,
            "all_fonts_count": len(fonts), "readme": readme, "texts": texts, "file_count": len(paths)}


# ----------------------------------------------------------------- font analysis
_LANGS = None


def languages():
    global _LANGS
    if _LANGS is None:
        from gflanguages import LoadLanguages
        out = []
        for lid, l in LoadLanguages().items():
            base = l.exemplar_chars.base
            if not base or l.historical:
                continue
            cps = set()
            for tok in base.split():
                tok = tok.strip("{}")
                for ch in tok:
                    if not (0x300 <= ord(ch) <= 0x36F):
                        cps.add(ord(ch))
            if cps:
                out.append((lid, l.name, l.script, l.population, cps,
                            l.sample_text.tester or l.sample_text.specimen_36 or ""))
        _LANGS = out
    return _LANGS


def pick_primary(paths):
    def rank(p):
        n = os.path.basename(p).lower()
        return (("italic" in n), not ("[" in n), not ("regular" in n), len(n))
    return sorted(paths, key=rank)[0]


def outline_stats(font):
    """Heuristic outline metrics on the default instance (cmap glyphs, max 600)."""
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.basePen import decomposeQuadraticSegment
    upm = font["head"].unitsPerEm
    gs = font.getGlyphSet()
    cmap = font.getBestCmap() or {}
    names = []
    seen = set()
    for cp in sorted(cmap):
        n = cmap[cp]
        if n not in seen and (0x21 <= cp):
            seen.add(n); names.append((cp, n))
    names = names[:600]
    st = dict(glyphs=0, contours=0, points=0, segs=0, lines=0, curves=0, miss_ext_contours=0, short=0, kinks=0,
              grid=True, lc_points=[], all_off=0)
    tol, short_len = max(1.0, upm / 1000), upm * 0.006

    def ext_missing(seg):
        pts = seg
        for axis in (0, 1):
            v = [p[axis] for p in pts]
            lo, hi = min(v[0], v[-1]), max(v[0], v[-1])
            if len(v) == 3:
                den = v[0] - 2 * v[1] + v[2]
                ts = [(v[0] - v[1]) / den] if den else []
                f = lambda t: (1 - t) ** 2 * v[0] + 2 * (1 - t) * t * v[1] + t * t * v[2]
            else:
                a = -v[0] + 3 * v[1] - 3 * v[2] + v[3]
                b = 2 * (v[0] - 2 * v[1] + v[2])
                c = v[1] - v[0]
                ts = []
                if abs(a) < 1e-9:
                    if b:
                        ts = [-c / b]
                else:
                    disc = b * b - 4 * a * c
                    if disc >= 0:
                        r = math.sqrt(disc)
                        ts = [(-b + r) / (2 * a), (-b - r) / (2 * a)]
                f = lambda t: (1 - t) ** 3 * v[0] + 3 * (1 - t) ** 2 * t * v[1] + 3 * (1 - t) * t * t * v[2] + t ** 3 * v[3]
            for t in ts:
                if 0.02 < t < 0.98:
                    x = f(t)
                    if x < lo - tol or x > hi + tol:
                        return True
        return False

    def ang(a, b):
        return math.atan2(b[1] - a[1], b[0] - a[0])

    for cp, n in names:
        pen = DecomposingRecordingPen(gs)
        try:
            gs[n].draw(pen)
        except Exception:
            continue
        contours, cur, start, last = [], None, None, None
        npts = 0
        for op, args in pen.value:
            if op == "moveTo":
                start = last = args[0]; cur = []; contours.append(cur); npts += 1
            elif op in ("lineTo", "curveTo") and (cur is None or last is None):
                continue
            elif op == "lineTo":
                cur.append([last, args[0]]); last = args[0]; npts += 1
            elif op == "curveTo":
                cur.append([last, *args]); last = args[-1]; npts += len(args)
            elif op == "qCurveTo":
                if args[-1] is None:  # contour made only of off-curve points: no moveTo, skip it
                    st["all_off"] += 1; npts += len(args) - 1; cur = None; last = None; continue
                if cur is None or last is None:
                    continue
                npts += len(args)
                for off, on in decomposeQuadraticSegment(args) if len(args) > 2 else [args]:
                    cur.append([last, off, on]); last = on
            elif op in ("closePath", "endPath") and cur is not None:
                if last is not None and last != start:
                    cur.append([last, start])
                last = None
        if not contours:
            continue
        st["glyphs"] += 1
        st["contours"] += len(contours)
        st["points"] += npts
        if 0x61 <= cp <= 0x7A:
            st["lc_points"].append(npts)
        for segs in contours:
            missing = False
            for s in segs:
                st["segs"] += 1
                pts = [tuple(p) for p in s]
                if any(p[0] % 1 or p[1] % 1 for p in pts) or any(int(c) % max(1, upm // 100) for p in pts for c in p):
                    st["grid"] = False
                if len(s) == 2:
                    st["lines"] += 1
                else:
                    st["curves"] += 1
                    if ext_missing(pts):
                        missing = True
                if 0 < math.dist(pts[0], pts[-1]) < short_len:
                    st["short"] += 1
            if missing:
                st["miss_ext_contours"] += 1
            # near-smooth joints ("kinks"): direction change between 0.6 and 8 degrees
            for k in range(len(segs)):
                a, b = segs[k - 1], segs[k]
                pin = next((p for p in reversed(a[:-1]) if tuple(p) != tuple(a[-1])), None)
                pout = next((p for p in b[1:] if tuple(p) != tuple(b[0])), None)
                if pin is None or pout is None:
                    continue
                d = abs((ang(pin, a[-1]) - ang(b[0], pout) + math.pi) % (2 * math.pi) - math.pi)
                if math.radians(0.6) < d < math.radians(8):
                    st["kinks"] += 1
    g = max(1, st["glyphs"])
    pixel = st["grid"] and st["curves"] == 0
    ppg = st["points"] / g
    lc = sum(st["lc_points"]) / len(st["lc_points"]) if st["lc_points"] else None
    mer = st["miss_ext_contours"] / max(1, st["contours"])
    kpg, spg = st["kinks"] / g, st["short"] / g
    score = 100.0
    if not pixel:
        score -= min(40, 120 * mer)
        score -= min(20, 5 * kpg)
        score -= min(20, 8 * spg)
        if lc and lc > 60:
            score -= min(15, (lc - 60) / 4)
    return {
        "glyphs_checked": st["glyphs"], "points_per_glyph": round(ppg, 1), "lc_points": round(lc, 1) if lc else None,
        "missing_extrema_pct": round(100 * mer, 1), "kinks_per_glyph": round(kpg, 2), "short_segs_per_glyph": round(spg, 2),
        "pixel": pixel, "score": max(0, round(score)),
        "autotrace": (not pixel) and sum([bool(lc and lc > 70), kpg > 1.0, mer > 0.3, spg > 1.0]),
    }


TOOLS = [("FontForge", r"fontforge"), ("Glyphs", r"\bglyphs\b(?! ?app\.js)"), ("FontLab", r"fontlab"),
         ("RoboFont", r"robofont"), ("Fontra", r"fontra"), ("fontmake / gftools", r"fontmake|gftools"),
         ("Calligraphr", r"calligraphr"), ("FontStruct", r"fontstruct"), ("BirdFont", r"birdfont"),
         ("Glyphr Studio", r"glyphr"), ("Fontself", r"fontself"), ("FontCreator", r"fontcreator|high-logic"),
         ("potrace / autotrace", r"potrace|autotrace"), ("ttfautohint", r"ttfautohint")]


def analyze_fonts(d, font_paths):
    from fontTools.ttLib import TTFont
    import glyphsets
    out = {"files": [os.path.basename(p) for p in font_paths]}
    fonts = []
    for p in font_paths[:12]:
        try:
            fonts.append((p, TTFont(os.path.join(d, p), lazy=False)))
        except Exception as e:
            out.setdefault("errors", []).append(f"{os.path.basename(p)}: {e}")
    if not fonts:
        return out
    prim_path = pick_primary([p for p, _ in fonts])
    prim = dict(fonts)[prim_path]
    out["primary"] = os.path.basename(prim_path)
    cmap = set()
    for _, f in fonts:
        cmap |= set((f.getBestCmap() or {}).keys())
    out["codepoints"] = len(cmap)
    out["glyph_count"] = prim["maxp"].numGlyphs
    out["upm"] = prim["head"].unitsPerEm
    name = prim["name"]
    fam = name.getBestFamilyName() or ""
    out["family_name"] = fam
    out["version"] = (name.getDebugName(5) or "")[:60]
    out["designer"] = (name.getDebugName(9) or "")[:200]
    out["manufacturer"] = (name.getDebugName(8) or "")[:200]
    if "fvar" in prim:
        out["axes"] = [{"tag": a.axisTag, "min": a.minValue, "def": a.defaultValue, "max": a.maxValue} for a in prim["fvar"].axes]
    out["styles"] = sorted({(f["name"].getBestSubFamilyName() or "") for _, f in fonts})
    # glyphsets (on the primary font, like fontspector's glyph_coverage)
    try:
        ful = glyphsets.get_glyphsets_fulfilled(prim)
        out["glyphsets"] = sorted(([k, round(v["percentage"] * 100, 1), len(v["missing"])] for k, v in ful.items()
                                   if v["percentage"] >= 0.5), key=lambda x: -x[1])
        lc = ful.get("GF_Latin_Core")
        out["latin_core_missing"] = [chr(c) for c in (lc or {}).get("missing", [])][:40] if lc else None
    except Exception as e:
        out["glyphsets"] = []
        out.setdefault("errors", []).append(f"glyphsets: {e}")
    # languages
    by_script, supported = collections.Counter(), []
    for lid, lname, script, pop, cps, sample in languages():
        if cps <= cmap:
            by_script[script] += 1
            supported.append((pop, lid, lname, script, sample))
    out["languages"] = sum(by_script.values())
    out["languages_by_script"] = by_script.most_common(8)
    from fontTools import unicodedata as ud
    scripts = collections.Counter(ud.script(chr(c)) for c in cmap)
    for s in ("Zyyy", "Zinh", "Zzzz"):
        scripts.pop(s, None)
    main = [s for s, n in scripts.most_common() if n >= 20]
    out["scripts"] = main[:6]
    non_latin = next((s for s in main if s != "Latn"), None)
    sample = ""
    if non_latin:
        cand = sorted([x for x in supported if x[3] == non_latin and x[4]], reverse=True)
        if cand:
            sample = cand[0][4][:140]
            out["sample_language"] = cand[0][2]
    # tools
    blob = " ".join((r.toUnicode() if hasattr(r, "toUnicode") else "") for r in name.names
                    if r.nameID in (0, 3, 5, 8, 9, 10, 11, 12, 13)).lower()
    if "FFTM" in prim:
        blob += " fontforge"
    out["tools"] = [t for t, rx in TOOLS if re.search(rx, blob)]
    out["name_text"] = blob[:3000]
    try:
        out["outlines"] = outline_stats(prim)
    except Exception as e:
        out.setdefault("errors", []).append(f"outlines: {e}")
    prim_cmap = set((prim.getBestCmap() or {}).keys())
    out["proof_missing"] = {k: "".join(sorted({c for c in v if not c.isspace() and ord(c) not in prim_cmap}))
                            for k, v in PROOFS.items()}
    try:
        out["outline_proof"] = outline_proof(prim)
    except Exception as e:
        out.setdefault("errors", []).append(f"outline proof: {e}")
    # specimen: subset of the primary font embedded in the page
    try:
        out["specimen"] = make_specimen(prim, cmap, fam, sample)
    except Exception as e:
        out.setdefault("errors", []).append(f"specimen: {e}")
    return out


# ----------------------------------------------------------------- proofs shown in each card
PROOFS = {
    "spacing": "AVATAR DIOXYDE TOTAL PAVARD AVADA KEDAVRA MONOXIDE ALTERNER NIGHTJAR CHIVVIED HRYVNIA TOTAL LOTTERIE "
               "avatar monoxide attendre after chivvied hryvnia onyx pentoxyverine wyverns miromesnil reference "
               "Avatar Tarte Panel Football",
    # every accented letter of GF Latin Core
    "accents": "Déjà vu où L’Haÿ : crème brûlée, pâte, fête, maïs, Noël, garçon, maître, ýmir, ñandú, así, però, così, "
               "São João, põe, Köln, Mädchen, våg, smørrebrød, þú, Æðey, læs, Straße, cœur\n"
               "Łódź, gęś, żółć, Dvořák, čaj, šťastný, děkuji, žůžo, ďateľ, vŕba, ĺúbiť, kôň, koń, Győr, műtő, đak, ćevapi, "
               "ğüneş, ışık, Iași, țară, Rīga, māja, ģērbs, ķēķis, ļoti, ņem, ūdens, įėjo, ąžuolas, ųsai, ċerv, ġbejna, ħobż, "
               "ŵyl, tŷ, ẁẃẅỳ\n"
               "ÀÁÂÃÄÅ ÆÇÈÉÊË ÌÍÎÏ ÐÑÒÓÔÕÖØ ŒÙÚÛÜÝÞẞŸ ĀĂĄĆĊČĎĐĒĖĘĚĞĠĢĦĪĮİĶĹĻĽŁŃŅŇŐŔŘŚŞŠȘŤȚŪŮŰŲŴŶŹŻŽ ẀẂẄỲ",
    # every punctuation mark and symbol of GF Latin Core
    "symbols": "Tickets cost $25, €23.50, £19 or ¥3,500 — that’s 15% off! Open 9–5; email “hello@type.studio” "
               "(subject: #42 & “Fonts”).\n"
               "A 12\" screen, 5'9\" tall: 3 × 4 ÷ 2 = 6, 7 − 2 + 1 < 9 > 5 · 20 °C · §12 ¶3 … [a/b] {c|d} ~e_f\\g ^h "
               "*well-known* • © 2026 Studio® Fonts™ 50¢ ¿Qué? ¡Sí! «Bonjour» ‹oui› „Hallo“ ‚ja‘ ‘yes’",
}
OUTLINE_LINES = ["Hamburgerfontsiv", "HAMBURGERFONTSIV", "1234567890"]


def outline_proof(font, lines=OUTLINE_LINES):
    """Glyph outlines in font units for an SVG view: one path per line, plus its on-curve points (no handles).
    Works for TrueType (quadratic) and CFF/CFF2 (cubic) outlines, on the default instance."""
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    gs = font.getGlyphSet()
    cmap = font.getBestCmap() or {}
    hmtx = font["hmtx"].metrics
    asc, desc = font["hhea"].ascent, font["hhea"].descent
    if asc - desc <= 0:
        asc, desc = font["head"].yMax, font["head"].yMin
    out = {"upm": font["head"].unitsPerEm, "asc": asc, "desc": desc, "lines": [], "points": 0}
    for text in lines:
        x, d, pts, missing = 0, [], [], []
        P = lambda pt: f"{round(x + pt[0])} {round(asc - pt[1])}"
        for ch in text:
            g = cmap.get(ord(ch))
            if g is None:
                missing.append(ch)
                continue
            pen = DecomposingRecordingPen(gs)
            try:
                gs[g].draw(pen)
            except Exception:
                missing.append(ch)
                continue
            for op, args in pen.value:
                if op == "moveTo":
                    d.append("M" + P(args[0])); pts.append(P(args[0]))
                elif op == "lineTo":
                    d.append("L" + P(args[0])); pts.append(P(args[0]))
                elif op == "curveTo":
                    d.append("C" + " ".join(P(a) for a in args)); pts.append(P(args[-1]))
                elif op == "qCurveTo":
                    offs = list(args[:-1])
                    if args[-1] is None:  # contour without on-curve points: start between the last and first
                        loop = offs + offs[:1]
                        mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                        d.append("M" + P(mid(offs[-1], offs[0])))
                        for i, o in enumerate(offs):
                            d.append("Q" + P(o) + " " + P(mid(o, loop[i + 1])))
                        continue
                    on = args[-1]
                    if not offs:
                        d.append("L" + P(on))
                    for i, o in enumerate(offs):  # implied on-curve points between off-curves are not drawn as points
                        end = on if i == len(offs) - 1 else ((o[0] + offs[i + 1][0]) / 2, (o[1] + offs[i + 1][1]) / 2)
                        d.append("Q" + P(o) + " " + P(end))
                    pts.append(P(on))
                elif op == "closePath":
                    d.append("Z")
            x += hmtx.get(g, (0, 0))[0]
        # points as one SVG path of zero-length segments, drawn as round dots
        out["lines"].append({"w": round(x), "d": "".join(d), "p": "".join("M" + q + "h0" for q in pts), "missing": "".join(missing)})
        out["points"] += len(pts)
    return out


def norm_name(n):
    import unicodedata as ud
    n = ud.normalize("NFKD", n or "")
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in n if not ud.combining(c)).lower())


def split_names(s):
    return [x.strip() for x in re.split(r"\s*(?:,|&|;|/|\+|\band\b|\bwith\b)\s*", s or "", flags=re.I) if x.strip()]


GENERIC_NAMES = {"", "multipledesigners", "unknown", "various", "designer", "none", "google", "googlefonts"}
DESIGNERS = {}  # normalised designer name -> [[family, date added], ...]


def load_designer_index(gf):
    """Families per designer, from the METADATA.pb files of a google/fonts clone (blobless clones are fine)."""
    DESIGNERS.clear()
    try:
        subprocess.run(["git", "-C", gf, "sparse-checkout", "set", "--no-cone", "/ofl/*/METADATA.pb", "/apache/*/METADATA.pb",
                        "/ufl/*/METADATA.pb"], check=True, capture_output=True)
        subprocess.run(["git", "-C", gf, "checkout", "-q", "main"], check=True, capture_output=True, timeout=1800)
        subprocess.run(["git", "-C", gf, "merge", "-q", "--ff-only", "origin/main"], capture_output=True, timeout=1800)
    except Exception as e:
        log(f"designer index: could not check out METADATA.pb files ({e})")
        return 0
    for lic in ("ofl", "apache", "ufl"):
        root = os.path.join(gf, lic)
        for fam in sorted(os.listdir(root)) if os.path.isdir(root) else []:
            p = os.path.join(root, fam, "METADATA.pb")
            if not os.path.exists(p):
                continue
            t = open(p, encoding="utf-8", errors="replace").read()
            name = (re.search(r'^name:\s*"([^"]*)"', t, re.M) or [None, fam])[1]
            date = (re.search(r'^date_added:\s*"([^"]*)"', t, re.M) or [None, ""])[1]
            for who in split_names((re.search(r'^designer:\s*"([^"]*)"', t, re.M) or [None, ""])[1]):
                k = norm_name(who)
                if k not in GENERIC_NAMES and len(k) >= 4:
                    DESIGNERS.setdefault(k, []).append([name, date])
    log(f"designer index: {len(DESIGNERS)} designers in google/fonts")
    return len(DESIGNERS)


def designer_history(rec):
    """Which of the names in the fonts (designer, manufacturer) or the submitter's profile already have families on GF."""
    f = rec.get("fonts") or {}
    # first designer only: later names are often the authors of the font a project is based on
    names = split_names(f.get("designer"))[:1] + split_names(f.get("manufacturer"))[:1]
    prof = rec.get("submitter") or {}
    if prof.get("name"):
        names.append(prof["name"])
    names = list(dict.fromkeys(names))
    seen, matched, fams = set(), [], {}
    for n in names:
        k = norm_name(n)
        if k in seen or k in GENERIC_NAMES or len(k) < 4:
            continue
        seen.add(k)
        if k in DESIGNERS:
            matched.append(n)
            for fam, date in DESIGNERS[k]:
                fams[fam] = date
    out = {"names": [n for n in names if norm_name(n) not in GENERIC_NAMES][:4], "matched": matched,
           "families": sorted(fams.items(), key=lambda x: x[1], reverse=True)[:12], "count": len(fams),
           "index": bool(DESIGNERS)}
    prev = [i for i in prof.get("gf_items", []) if i["number"] != rec["number"]]
    out["accepted"] = len([i for i in prev if any(l in ("II Accepted", "--- Live") for l in i["labels"])
                           or (i["is_pr"] and i["state"] == "closed")])
    return out


def make_specimen(font, cmap, fam, sample):
    from fontTools import subset
    from fontTools.ttLib import TTFont
    latin = "Hamburgefonstiv 0123456789 Sphinx of black quartz, judge my vow. ÀÉÎõüçßŁ€&?!"
    lines = [fam or "Specimen"]
    if 0x61 in cmap and 0x41 in cmap:
        lines += ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", latin]
    if sample:
        lines.append(sample)
    grid = [chr(c) for c in sorted(cmap) if c > 0x20 and not (0x300 <= c <= 0x36F)][:480]
    text = "".join(lines) + "".join(grid) + "".join(PROOFS.values())
    buf = io.BytesIO()
    font.save(buf)
    f2 = TTFont(io.BytesIO(buf.getvalue()))
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = []
    opts.notdef_outline = True
    opts.hinting = False
    opts.drop_tables += ["DSIG"]
    try:
        import brotli  # noqa: F401
        opts.flavor, mime = "woff2", "font/woff2"
    except ImportError:
        mime = "font/ttf"
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(f2)
    out = io.BytesIO()
    subset.save_font(f2, out, opts)
    data = out.getvalue()
    return {"data": f"data:{mime};base64," + base64.b64encode(data).decode(), "size": len(data),
            "lines": [l for l in lines if l], "grid": "".join(grid)}


# ----------------------------------------------------------------- QA
NETWORK_CHECKS = {"googlefonts/metadata/broken_links", "googlefonts/description/broken_links", "fontdata_namecheck",
                  "googlefonts/metadata/includes_production_subsets", "googlefonts/axes_match",
                  "googlefonts/vertical_metrics", "googlefonts/vertical_metrics_regressions",
                  "googlefonts/cjk_vertical_metrics", "googlefonts/cjk_vertical_metrics_regressions",
                  "googlefonts/version_bump", "googlefonts/production_glyphs_similarity", "fontbakery_version",
                  "googlefonts/production_encoded_glyphs", "googlefonts/metadata/designer_profiles"}
SEV = {"PASS": 0, "SKIP": 0, "INFO": 1, "WARN": 2, "FAIL": 3, "ERROR": 3, "FATAL": 4}


QA_DEADLINE = None  # time.monotonic() after which QA is left for the next run (hosted builds)


def run_qa(d, font_paths, checker, cache, sha):
    if not font_paths or checker == "none":
        return None
    key = f"qa:{checker}:{sha}:{','.join(font_paths)}"
    hit = cache.get(key, 24 * 30)
    if hit is not None:
        return hit
    left = QA_DEADLINE - time.monotonic() if QA_DEADLINE else None
    if left is not None and left < 60:
        return None
    files = [os.path.join(d, p) for p in font_paths[:20]]
    tmp = os.path.join(cache.root, "qa_tmp_" + hashlib.sha1(key.encode()).hexdigest()[:10] + ".json")
    res = None
    if checker in ("auto", "fontspector") and shutil.which("fontspector"):
        try:
            subprocess.run(["fontspector", "--profile", "googlefonts", "--json", tmp] + files,
                           capture_output=True, timeout=int(min(900, left or 900)))
            if os.path.exists(tmp):
                res = parse_any_report(json.load(open(tmp)), "fontspector")
        except Exception as e:
            log(f"fontspector failed: {e}")
    if res is None and checker in ("auto", "fontbakery") and shutil.which("fontbakery"):
        try:
            subprocess.run(["fontbakery", "check-googlefonts", "-l", "FAIL", "--json", tmp] + files,
                           capture_output=True, timeout=int(min(1500, left or 1500)))
            if os.path.exists(tmp):
                res = parse_any_report(json.load(open(tmp)), "fontbakery")
        except Exception as e:
            log(f"fontbakery failed: {e}")
    if os.path.exists(tmp):
        os.remove(tmp)
    return cache.put(key, res) if res else None


def parse_any_report(doc, tool):
    """Collect worst status per check id from a fontspector or fontbakery JSON report."""
    worst = {}

    def visit(o):
        if isinstance(o, dict):
            cid = o.get("check_id") or o.get("checkid") or o.get("id")
            if cid is None and isinstance(o.get("key"), list) and len(o["key"]) > 1:
                cid = str(o["key"][1])
            status = o.get("worst_status") or o.get("status") or o.get("result") or o.get("severity")
            if isinstance(cid, str) and isinstance(status, str) and status.upper() in SEV:
                cid = re.sub(r"^<FontBakeryCheck:|>$", "", cid).replace("com.google.fonts/check/", "")
                s = status.upper()
                if SEV[s] >= SEV.get(worst.get(cid, "PASS"), 0):
                    worst[cid] = s
            for v in o.values():
                visit(v)
        elif isinstance(o, list):
            for v in o:
                visit(v)

    visit(doc)
    if not worst:
        return None
    fails = sorted(c for c, s in worst.items() if s in ("FAIL", "FATAL") and c not in NETWORK_CHECKS)
    errors = sorted(c for c, s in worst.items() if s == "ERROR" and c not in NETWORK_CHECKS)
    warns = sorted(c for c, s in worst.items() if s == "WARN")
    return {"tool": tool, "fail": fails, "error": errors, "warn_count": len(warns),
            "glyph_coverage": "FAIL" if any(c.endswith("glyph_coverage") for c in fails) else
            ("PASS" if any(c.endswith("glyph_coverage") for c in worst) else None),
            "outline_warns": sorted(c for c in warns if "outline" in c)}


# ----------------------------------------------------------------- text signals
AI_RX = re.compile(r"\b(A\.?I\.?(?=[\s,.;:)!?/-]|$)(?!\s*(?:Sans|Mono|Serif))|artificial intelligence|generative|"
                   r"midjourney|stable diffusion|dall[ -]?e|chat ?gpt|gpt-?\d|openai|claude|anthropic|gemini|copilot|"
                   r"\bllms?\b|machine learning|neural net\w*|vibe[- ]?cod\w*)", re.I)
NO_AI_RX = re.compile(r"\b(no|not|without|never|didn'?t|did not)\b[^.\n]{0,40}\b(A\.?I\.?|artificial intelligence|generat\w+)\b", re.I)
DERIV_RX = re.compile(r"\b(derivative of|based on|fork(?:ed)? (?:of|from)|remix(?:ed)? of|modified version of|"
                      r"extension of|adapted from|built (?:on|upon)|expanded from|revival of)\b", re.I)


# What AI was used for, read clause by clause. "design": AI drew, generated or expanded the glyphs.
AI_DESIGN_RX = re.compile(r"\b(glyphs?|outlines?|letterforms?|character set|characters|glyph geometry|geometry|shapes|"
                          r"forms|draw\w*|drew|construct\w*|expan(?:d|sion|ded)|character sheet|kern\w*|spacing|vectori[sz]\w*|"
                          r"designed the (?:font|typeface|letters))\b", re.I)
AI_TECH_RX = re.compile(r"\b(build\w*|tooling|tools? for|scripts?|scripting|qa|quality assurance|fontbakery|fontspector|"
                        r"documentation|docs|readme|repo\w*|specimen|website|site|pipeline|engineering|metadata|name table|"
                        r"stat|metrics|automation|cleanup|planning|coding|code review|conformance|compliance|packaging|ci)\b", re.I)
AI_IMAGE_RX = re.compile(r"\b(midjourney|dall[ -]?e|stable diffusion|gpt[- ]image|firefly|image[- ]generat\w+|"
                         r"text[- ]to[- ]image)\b", re.I)
AI_NEG_RX = re.compile(r"\b(not|no|never|none|without)\b", re.I)
TEMPLATE_AI_RX = re.compile(r"commit to clearly disclosing if AI tools were used", re.I)


def ai_use(text):
    """Classify the AI statements of a submission: design / technical / unclear / none, with the clauses used."""
    clauses = []
    for para in re.split(r"\n\s*\n", text or ""):
        if not AI_RX.search(para) and not AI_IMAGE_RX.search(para):
            continue
        para = re.sub(r"\n(?!\s*(?:[-*•]|\d+\.)\s)", " ", para)   # re-join lines wrapped mid-sentence
        for c in re.split(r"(?<=[.!?;])\s+|\n+|;\s*", para):
            c = re.sub(r"\s+", " ", c).strip(" -*•")
            if c and (AI_RX.search(c) or AI_IMAGE_RX.search(c)) and not TEMPLATE_AI_RX.search(c):
                clauses.append(c[:300])
    design, tech, denied = [], [], []
    for c in dict.fromkeys(clauses):
        if AI_IMAGE_RX.search(c):
            design.append(c)
        elif AI_DESIGN_RX.search(c) and AI_NEG_RX.search(c):
            denied.append(c)          # "No glyphs were AI-generated", "not used to draw…"
        elif AI_DESIGN_RX.search(c):
            design.append(c)
        elif AI_TECH_RX.search(c):
            tech.append(c)
    image = any(AI_IMAGE_RX.search(c) for c in design)
    if design and (image or not denied):
        kind = "design"
    elif tech or denied:
        kind = "technical"
    elif clauses:
        kind = "unclear"
    else:
        kind = "none"
    return {"kind": kind, "design": design[:3], "technical": tech[:3], "denied": denied[:2]}


AI_KINDS = {"design": "AI used to design the glyphs", "suspected": "AI design suspected",
            "technical": "AI for technical work only", "unclear": "AI mentioned, use unclear", "none": "No AI mentioned"}


def snippets(rx, text, n=2, width=110):
    out = []
    for m in rx.finditer(text):
        a, b = max(0, m.start() - width), min(len(text), m.end() + width)
        s = re.sub(r"\s+", " ", text[a:b]).strip()
        if not any(s[:40] in o for o in out):
            out.append(("…" if a else "") + s + ("…" if b < len(text) else ""))
        if len(out) >= n:
            break
    return out


def strip_template(body):
    return "\n".join(l for l in (body or "").splitlines() if not re.match(r"\s*[-*]\s*\[[ xX]\]", l))


# ----------------------------------------------------------------- one submission
def analyse(issue, args, cache, offline):
    n = issue["number"]
    body = issue.get("body") or ""
    rec = {
        "number": n, "title": issue["title"], "url": issue["html_url"], "author": issue["user"]["login"],
        "author_assoc": issue.get("author_association"), "created": issue["created_at"][:10],
        "updated": issue["updated_at"][:10], "labels": [l["name"] for l in issue["labels"]],
        "assignees": [a["login"] for a in issue.get("assignees") or []], "comments_count": issue.get("comments", 0),
        "family_guess": family_from_title(issue["title"]), "notes": [],
    }
    checks = re.findall(r"^\s*[-*]\s*\[([ xX])\]", body, re.M)
    rec["checklist"] = {"done": sum(c.lower() == "x" for c in checks), "total": len(checks),
                        "unchecked": [re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", l.split("]", 1)[1]).strip()[:140]
                                      for l in body.splitlines() if re.match(r"\s*[-*]\s*\[ \]", l)][:8]}
    img = re.search(r"!\[[^\]]*\]\((https?://[^)\s]+)\)|<img[^>]+src=\"(https?://[^\"]+)\"", body)
    rec["issue_image"] = (img.group(1) or img.group(2)) if img else None
    # comments: last activity + triage bot summary
    if not offline:
        cm = gh_get(f"repos/{REPO}/issues/{n}/comments", paginate=True, per_page="100") or []
        bot = next((c for c in reversed(cm) if c["user"]["login"].endswith("[bot]") and "triage" in (c["body"] or "").lower()), None)
        if bot:
            rec["bot"] = {"url": bot["html_url"], "date": bot["created_at"][:10], "body": bot["body"][:4000]}
        rec["engagement"] = engagement(cm, rec["author"])
        human = [c for c in cm if not c["user"]["login"].endswith("[bot]")]
        if human:
            last = human[-1]
            team = last.get("author_association") in ("OWNER", "MEMBER", "COLLABORATOR")
            rec["last_comment"] = {"by": last["user"]["login"], "date": last["created_at"][:10], "team": team,
                                   "url": last["html_url"], "text": re.sub(r"\s+", " ", last["body"] or "")[:240]}
            rec["waiting_on"] = "submitter" if team and last["user"]["login"] != rec["author"] else \
                ("Google Fonts" if last["user"]["login"] == rec["author"] else None)
        if not args.no_submitter:
            rec["submitter"] = submitter_profile(rec["author"], cache)
    # repo
    repo = find_repo(body, issue["title"])
    rec["repo"] = repo
    text_for_signals = strip_template(body)
    if repo:
        if not offline and repo["host"] == "github.com":
            meta = gh_get(f"repos/{repo['owner']}/{repo['name']}")
            if meta:
                repo.update({"created": meta.get("created_at", "")[:10], "pushed": meta.get("pushed_at", "")[:10],
                             "stars": meta.get("stargazers_count"), "fork": meta.get("fork"),
                             "parent": (meta.get("parent") or {}).get("full_name"),
                             "owner_type": (meta.get("owner") or {}).get("type")})
                if repo["owner"].lower() != rec["author"].lower() and repo.get("owner_type") == "Organization":
                    o = gh_get(f"users/{repo['owner']}") or {}
                    repo["owner_info"] = {"login": repo["owner"], "repos": o.get("public_repos"), "blog": o.get("blog") or "",
                                          "created": (o.get("created_at") or "")[:10]}
        d, head = clone(repo, args.cache)
        repo["head"] = head
        if d:
            info = inspect_repo(d)
            rec["repo_info"] = {k: v for k, v in info.items() if k != "texts"}
            text_for_signals += "\n" + info["texts"]
            if info["fonts"]:
                rec["fonts"] = analyze_fonts(d, info["fonts"])
                text_for_signals += "\n" + rec["fonts"].pop("name_text", "")
                rec["qa"] = run_qa(d, info["fonts"], args.checker, cache, head.get("sha", ""))
    # signals
    ai_hits = snippets(AI_RX, text_for_signals)
    no_ai = snippets(NO_AI_RX, text_for_signals, 1)
    disclosure = re.search(r"\*\*AI disclosure:?\*\*:?\s*(.+)", body, re.I)
    ai = {"disclosure": disclosure.group(1).strip()[:400] if disclosure else None, "mentions": ai_hits, "denial": no_ai}
    reasons = []
    ol = (rec.get("fonts") or {}).get("outlines") or {}
    if ol.get("autotrace", 0) >= 2:
        reasons.append("auto-traced-looking outlines (many points, near-smooth kinks, missing extrema)")
    tools = (rec.get("fonts") or {}).get("tools", [])
    if any(t in tools for t in ("potrace / autotrace", "Calligraphr")):
        reasons.append("made with " + ", ".join(t for t in tools if t in ("potrace / autotrace", "Calligraphr")))
    sub = rec.get("submitter") or {}
    if sub.get("created"):
        age = (NOW.date() - dt.date.fromisoformat(sub["created"])).days
        if age < 60:
            reasons.append(f"GitHub account created {age} days ago")
    if repo and repo.get("created") and rec["created"]:
        gap = (dt.date.fromisoformat(rec["created"]) - dt.date.fromisoformat(repo["created"])).days
        if 0 <= gap <= 7:
            reasons.append(f"repo created {gap} day(s) before the issue")
    disclosed_prose = [h for h in ai_hits if re.search(r"disclos|assist|were used|was used|with the help|helped|used (?:to|for)", h, re.I)]
    if (ai["disclosure"] and not re.search(r"\b(no|not|none|n/a)\b", ai["disclosure"][:30], re.I)) or disclosed_prose:
        verdict = "Disclosed AI use"
    elif ai_hits and not no_ai:
        verdict = "AI mentioned"
    elif len(reasons) >= 2:
        verdict = "Several signals"
    elif reasons:
        verdict = "One signal"
    elif no_ai:
        verdict = "States no AI used"
    else:
        verdict = "No signal found"
    ai["verdict"], ai["reasons"] = verdict, reasons
    ai.update(ai_use(text_for_signals))
    if ai["kind"] in ("unclear", "none") and (verdict == "Several signals" or (ol.get("autotrace", 0) >= 2 and ai["kind"] == "unclear")):
        ai["kind"] = "suspected"      # no clear statement, but the outlines or the account look like it
    ai["kind_label"] = AI_KINDS[ai["kind"]]
    rec["ai"] = ai
    rec["derivative"] = snippets(DERIV_RX, text_for_signals, 2)
    if repo and repo.get("fork"):
        rec["derivative"].insert(0, f"Repository is a GitHub fork of {repo.get('parent')}")
    rec["designer"] = designer_history(rec)
    rec["score"] = score(rec)
    rec["draft_comment"] = draft_comment(rec)
    return rec


FOLLOWUP_RX = re.compile(r"\b(any (?:news|updates?|progress|feedback)|update\?|status|ping|follow(?:ing)?[- ]?up|bump|reminder|"
                         r"still (?:waiting|interested|pending)|checking in|is there anything|when (?:will|can|could)|"
                         r"gentle|kindly)\b", re.I)
TEAM = ("OWNER", "MEMBER", "COLLABORATOR")


def engagement(comments, author):
    """How the submitter takes part in the issue: comments, follow-ups, answers to the team."""
    me = author.lower()
    own = [c for c in comments if c["user"]["login"].lower() == me]
    team = [c for c in comments if c.get("author_association") in TEAM and c["user"]["login"].lower() != me]
    follow = [c for c in own if FOLLOWUP_RX.search(c.get("body") or "")]
    answered = sum(1 for t in team if any(o["created_at"] > t["created_at"] for o in own))
    return {"comments": len(own), "followups": len(follow), "team_comments": len(team), "answered": answered,
            "last": own[-1]["created_at"][:10] if own else None,
            "last_followup": follow[-1]["created_at"][:10] if follow else None,
            "last_url": own[-1]["html_url"] if own else None}


# ----------------------------------------------------------------- score & comment
def score(rec):
    parts = []
    f = rec.get("fonts") or {}
    # character set (25)
    sets = {k: pct for k, pct, _ in f.get("glyphsets", [])}
    cs = 0.0
    if sets.get("GF_Latin_Core", 0) >= 99.9:
        cs += 8
    elif sets.get("GF_Latin_Core"):
        cs += 8 * sets["GF_Latin_Core"] / 100 * 0.5
    for k, pts in (("GF_Latin_Plus", 3), ("GF_Latin_Vietnamese", 1), ("GF_Latin_African", 1), ("GF_Latin_Beyond", 1)):
        if sets.get(k, 0) >= 99.9:
            cs += pts
    others = [k for k, v in sets.items() if v >= 99.9 and not k.startswith(("GF_Latin", "GF_TransLatin", "GF_Phonetics"))]
    cs += min(6, 3 * len(others))
    langs = f.get("languages", 0)
    cs += min(5, 5 * math.log10(1 + langs) / math.log10(400)) if langs else 0
    if not sets.get("GF_Latin_Core") and others:
        cs += 4  # non-Latin family: no Latin Core expected
    parts.append(["Character set", round(min(25, cs), 1), 25, f"{len([v for v in sets.values() if v >= 99.9])} GF glyphsets complete, {langs} languages"])
    # QA (20)
    qa = rec.get("qa")
    if qa:
        q = max(0, 20 - 2 * len(qa["fail"]) - (5 if qa.get("glyph_coverage") == "FAIL" else 0))
        parts.append(["QA (" + qa["tool"] + ")", q, 20, f"{len(qa['fail'])} FAIL, {qa['warn_count']} WARN"])
    else:
        parts.append(["QA", 0, 20, "not run (no fonts found or no checker installed)"])
    # outlines (15)
    ol = f.get("outlines")
    parts.append(["Outline quality", round(15 * ol["score"] / 100, 1) if ol else 0, 15,
                  f"{ol['score']}/100" if ol else "no fonts to check"])
    # sources (15)
    src = (rec.get("repo_info") or {}).get("sources") or {}
    sp = max([v["points"] for v in src.values()] or [0])
    parts.append(["Sources", sp, 15, ", ".join(src) or "no editable sources found"])
    # licence & template (5)
    ri = rec.get("repo_info") or {}
    lic = ri.get("license") or {}
    tp = ri.get("template") or {}
    lt = (3 if lic.get("ofl11") and not lic.get("rfn") else (1 if lic.get("ofl11") else 0)) + \
         (2 if tp.get("sources/config.yaml") and (tp.get("Makefile") or tp.get("requirements")) else (1 if tp.get("sources/config.yaml") else 0))
    parts.append(["Licence & repo structure", lt, 5, ("OFL 1.1" if lic.get("ofl11") else "no OFL 1.1 found") +
                  (", RFN: " + ", ".join(lic["rfn"]) if lic.get("rfn") else "")])
    # submitter (10)
    s = rec.get("submitter")
    if s:
        sa = 0
        if s.get("created"):
            age = (NOW.date() - dt.date.fromisoformat(s["created"])).days
            sa += 4 if age > 730 else (2 if age > 180 else 0)
        prev = [i for i in s.get("gf_items", []) if i["number"] != rec["number"]]
        accepted = [i for i in prev if any(l in ("II Accepted", "--- Live") for l in i["labels"]) or (i["is_pr"] and i["state"] == "closed")]
        sa += 4 if accepted else (2 if prev else 0)
        sa += 2 if (s.get("public_repos") or 0) >= 5 or s.get("company") or s.get("orgs") or (rec.get("repo") or {}).get("owner_info") else 0
        parts.append(["Submitter history", round(sa / 2, 1), 5, f"{len(prev)} other google/fonts issues/PRs, {len(accepted)} accepted or merged"])
    else:
        parts.append(["Submitter history", 0, 5, "not fetched (offline mode)"])
    e = rec.get("engagement")
    if e is not None:
        ep = min(2, e["comments"])                                  # takes part in the issue
        if e["team_comments"]:
            ep += 2 if e["answered"] else 0                         # answers the team
        elif e["comments"]:
            ep += 1
        if e["last"] and (NOW.date() - dt.date.fromisoformat(e["last"])).days <= 90:
            ep += 1                                                 # recently active
        why = (f"{e['comments']} comment(s) by the submitter, {e['followups']} follow-up(s)"
               + (f", answered {e['answered']}/{e['team_comments']} team comment(s)" if e["team_comments"] else "")
               + (f", last {e['last']}" if e["last"] else ""))
        parts.append(["Engagement on the issue", min(5, ep), 5, why])
    else:
        parts.append(["Engagement on the issue", 0, 5, "comments not fetched (offline mode)"])
    auto = round(sum(p[1] for p in parts), 1)
    return {"auto": auto, "auto_max": 90, "parts": parts}


PROPOSALS = {  # level -> (label, rank used by the "Recommendation" sort)
    "soon": ("Publish soon", 0),
    "later": ("Publish, schedule for later", 1),
    "changes": ("Ask the designer for changes", 2),
    "look": ("Look closer before deciding", 3),
    "info": ("Missing information", 4),
}


def proposal(rec):
    """A suggested decision with its reasons. Heuristic: it orders the work, a person decides."""
    f, ri, qa = rec.get("fonts") or {}, rec.get("repo_info") or {}, rec.get("qa")
    good, bad = [], []
    if rec.get("error"):
        return {"level": "info", "label": PROPOSALS["info"][0], "rank": 4, "good": [], "bad": ["the analysis failed"]}
    if not rec.get("repo"):
        bad.append("no repository link in the issue")
    elif not rec.get("repo_info"):
        bad.append("the repository could not be read")
    elif not f.get("files"):
        bad.append("no font files in the repository")
    if bad:
        return {"level": "info", "label": PROPOSALS["info"][0], "rank": 4, "good": [], "bad": bad}
    # character set
    sets = {k: pct for k, pct, _ in f.get("glyphsets", [])}
    full = [k for k, v in sets.items() if v >= 99.9]
    non_latin = [k for k in full if not k.startswith(("GF_Latin", "GF_TransLatin", "GF_Phonetics"))]
    langs = f.get("languages", 0)
    latin_font = "Latn" in (f.get("scripts") or [])
    core_ok = "GF_Latin_Core" in full
    glyphs_ok = core_ok or (non_latin and not latin_font)
    extra = [k for k in full if k in ("GF_Latin_Plus", "GF_Latin_Vietnamese", "GF_Latin_African", "GF_Latin_Beyond")]
    glyphs_wide = glyphs_ok and (langs >= 350 or extra or (non_latin and core_ok))
    shown = [k for k in full if k != "GF_Latin_Kernel" and "Historical" not in k]
    shown.sort(key=lambda k: (k.startswith("GF_Latin"), k != "GF_Latin_Core", k))
    sets_txt = ", ".join(k.replace("GF_", "").replace("_", " ") for k in shown[:3]) or "no complete GF glyphset"
    if glyphs_wide:
        good.append(f"wide character set ({sets_txt}, {langs} languages)")
    elif glyphs_ok:
        good.append(f"character set complete ({sets_txt}, {langs} languages)")
    elif latin_font and not core_ok:
        bad.append(f"GF Latin Core incomplete ({len(f.get('latin_core_missing') or [])}+ characters missing)")
    else:
        bad.append("no complete GF glyphset")
    # technical quality
    fails = len(qa["fail"]) if qa else None
    ol = (f.get("outlines") or {})
    olscore = ol.get("score")
    if fails is None:
        bad.append("QA not run yet")
    elif fails == 0:
        good.append(f"no FAIL ({qa['tool']})")
    elif fails <= 3:
        good.append(f"{fails} FAIL{'s' if fails > 1 else ''} to fix at onboarding")
    else:
        bad.append(f"{fails} FAILs ({qa['tool']})")
    if qa and qa.get("glyph_coverage") == "FAIL" and not any("Latin Core" in b for b in bad):
        bad.append("glyph coverage check FAILs")
    if olscore is not None:
        if ol.get("pixel"):
            good.append("pixel / grid outlines")
        elif olscore >= 75:
            good.append(f"clean outlines ({olscore}/100)")
        elif olscore < 55:
            bad.append(f"outlines need work ({olscore}/100)")
    tech_ok = fails is not None and fails <= 3 and (olscore is None or olscore >= 75 or ol.get("pixel"))
    # designer
    des = rec.get("designer") or {}
    if des.get("count"):
        fams = ", ".join(x[0] for x in des["families"][:3])
        good.append(f"known designer: {des['count']} famil{'y' if des['count'] == 1 else 'ies'} on Google Fonts ({fams})")
    elif des.get("accepted"):
        good.append(f"submitter already has {des['accepted']} accepted submission(s)")
    designer_known = bool(des.get("count") or des.get("accepted"))
    # what the designer has to change
    lic = ri.get("license") or {}
    changes = []
    if not ri.get("sources"):
        changes.append("no editable sources")
    if not lic.get("ofl11"):
        changes.append("no OFL 1.1 licence")
    if lic.get("rfn"):
        changes.append("Reserved Font Name in OFL.txt")
    cl = rec.get("checklist") or {}
    if cl.get("total") and cl.get("done", 0) < cl["total"]:
        changes.append(f"checklist {cl['done']}/{cl['total']}")
    # reasons to look closer
    ai = rec.get("ai") or {}
    look = []
    if ai.get("kind") == "design":
        look.append("AI used to design the glyphs" + (" (image generator)" if any(AI_IMAGE_RX.search(c) for c in ai.get("design", [])) else ""))
    elif ai.get("kind") == "suspected":
        look.append("AI design suspected (no clear statement)")
    ai_note = "AI mentioned: check how it was used" if ai.get("kind") == "unclear" else None
    if ai.get("kind") == "technical":
        good.append("AI used for technical work only")
    if (ol.get("autotrace") or 0) >= 2:
        look.append("outlines look auto-traced")
    if rec.get("same_repo"):
        look.append("same repository as " + ", ".join(f"#{n}" for n in rec["same_repo"]))
    if (rec.get("repo") or {}).get("fork"):
        look.append("repository is a fork")
    if look:
        level = "look"
        bad = look + changes + bad
    elif changes or (fails is not None and fails > 10) or (olscore is not None and olscore < 55 and not ol.get("pixel")) \
            or (latin_font and not core_ok and not non_latin):
        level = "changes"
        bad = changes + bad
    elif tech_ok and glyphs_ok and designer_known and not ai_note:
        level = "soon"
    else:
        level = "later"
        if not designer_known:
            bad.append("new designer: no family on Google Fonts yet" if des.get("index") else "designer history unknown")
    if ai_note:
        bad.append(ai_note)
    eng = rec.get("engagement") or {}
    if eng.get("comments"):
        good.append(f"submitter active on the issue ({eng['comments']} comment{'s' if eng['comments'] > 1 else ''}, last {eng['last']})")
    return {"level": level, "label": PROPOSALS[level][0], "rank": PROPOSALS[level][1], "good": good, "bad": bad}


def draft_comment(rec):
    items = []
    if not rec.get("repo"):
        items.append("We couldn't find the font project's Git repository URL in the issue. Could you add it?")
    elif not (rec["repo"].get("head") or {}).get("sha"):
        items.append(f"We couldn't clone {rec['repo']['url']}. Is the repository public?")
    ri = rec.get("repo_info") or {}
    if rec.get("repo_info"):
        if not ri.get("sources"):
            items.append("The repository doesn't seem to include editable sources (.glyphs, .ufo/.designspace…). Please add them.")
        if not ri.get("fonts"):
            items.append("We couldn't find built font files (fonts/…ttf) in the repository.")
        lic = ri.get("license") or {}
        if not lic.get("ofl11"):
            items.append("Please add the SIL Open Font License 1.1 as OFL.txt at the root of the repository.")
        if lic.get("rfn"):
            items.append(f"The OFL.txt declares Reserved Font Names ({', '.join(lic['rfn'])}); Google Fonts can't accept RFNs.")
        if not (ri.get("template") or {}).get("sources/config.yaml"):
            items.append("Please follow the Google Fonts repository structure (sources/config.yaml for gftools builder): "
                         "https://googlefonts.github.io/gf-guide/upstream.html")
    f = rec.get("fonts") or {}
    if f.get("latin_core_missing"):
        items.append(f"The fonts are missing {len(f['latin_core_missing'])}+ characters of GF Latin Core, e.g. "
                     + " ".join(f["latin_core_missing"][:12]))
    qa = rec.get("qa")
    if qa and qa["fail"]:
        items.append(f"{qa['tool']} (googlefonts profile) reports {len(qa['fail'])} FAILs, e.g. "
                     + ", ".join("`" + c + "`" for c in qa["fail"][:6]) + ".")
    cl = rec.get("checklist") or {}
    if cl.get("unchecked"):
        items.append("Some requirements in the submission checklist are not ticked: " + "; ".join(cl["unchecked"][:3]))
    ai = rec.get("ai") or {}
    if ai.get("kind") in ("suspected", "unclear"):
        items.append("Could you tell us whether AI tools were used to create this project, and how?")
    if not items:
        return ""
    return (f"Hi @{rec['author']}, thanks for submitting {rec['family_guess']}! Before we can review it, "
            "could you please look at the following:\n\n" + "\n".join("- " + i for i in items) + "\n\nThanks!")


# ----------------------------------------------------------------- report
def build_report(recs, meta, out_path):
    here = os.path.dirname(os.path.abspath(__file__))
    tpl_path = TEMPLATE or next((p for p in (os.path.join(here, "report_template.html"),
                                             os.path.join(here, "submissions_template.html")) if os.path.exists(p)))
    tpl = open(tpl_path, encoding="utf-8").read()
    data = json.dumps({"meta": meta, "items": recs}, ensure_ascii=False).replace("</", "<\\/")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(tpl.replace("/*__DATA__*/null", data))
    return out_path


def generate(args):
    LOG.clear()
    os.makedirs(args.cache, exist_ok=True)
    cache = Cache(args.cache)
    offline = bool(args.issues_json)
    if offline:
        issues, ms = load_offline(args.issues_json), None
        log(f"offline mode: {len(issues)} submissions in {args.issues_json}")
    else:
        issues, ms = fetch_submissions()
        log(f"{len(issues)} open issues with label “{LABEL}” in milestone “{MILESTONE}”")
    recs = []
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        futs = {ex.submit(analyse, i, args, cache, offline): i for i in issues}
        for k, fu in enumerate(cf.as_completed(futs), 1):
            i = futs[fu]
            try:
                recs.append(fu.result())
                log(f"[{k}/{len(issues)}] #{i['number']} {i['title'][:60]}")
            except Exception as e:
                log(f"[{k}/{len(issues)}] #{i['number']} failed: {e}")
                traceback.print_exc()
                recs.append({"number": i["number"], "title": i["title"], "url": i["html_url"],
                             "author": i["user"]["login"], "created": i["created_at"][:10], "error": str(e),
                             "score": {"auto": 0, "auto_max": 90, "parts": []}})
    # what left the queue since the previous report
    prev_path = os.path.join(args.cache, "last_run.json")
    prev = json.load(open(prev_path)) if os.path.exists(prev_path) else {}
    now_ids = {str(r["number"]) for r in recs}
    left = []
    for num, title in prev.get("items", {}).items():
        if num in now_ids:
            continue
        why = "no longer in the list"
        if not offline:
            it = gh_get(f"repos/{REPO}/issues/{num}") or {}
            labels = [l["name"] for l in it.get("labels", [])]
            if it.get("state") == "closed":
                why = "closed"
            elif "II Accepted" in labels:
                why = "accepted"
            elif (it.get("milestone") or {}).get("title") != MILESTONE:
                why = "moved to " + ((it.get("milestone") or {}).get("title") or "no milestone")
            elif LABEL not in labels:
                why = f"“{LABEL}” label removed"
        left.append({"number": int(num), "title": title, "why": why, "url": f"https://github.com/{REPO}/issues/{num}"})
    json.dump({"date": dt.datetime.now().astimezone().isoformat(), "items": {str(r["number"]): r["title"] for r in recs}}, open(prev_path, "w"))
    meta = {"generated": dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"), "count": len(recs),
            "generated_iso": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "hosted": bool(args.hosted), "update_url": args.update_url or "", "show_submitter": not args.no_submitter,
            "offline": offline, "checker": args.checker, "previous": prev.get("date", "")[:16].replace("T", " "),
            "new": sorted(int(x) for x in now_ids - set(prev.get("items", {}))) if prev else [],
            "left": sorted(left, key=lambda x: -x["number"]), "label": LABEL, "milestone": MILESTONE,
            "milestone_url": (ms or {}).get("html_url", ""), "log": LOG[-200:], "proofs": PROOFS,
            "designer_index": len(DESIGNERS)}
    by_repo = collections.defaultdict(list)
    for r in recs:
        if r.get("repo"):
            by_repo[r["repo"]["url"].lower()].append(r["number"])
    for r in recs:
        if r.get("repo"):
            others = [n for n in by_repo[r["repo"]["url"].lower()] if n != r["number"]]
            if others:
                r["same_repo"] = sorted(others)
    for r in recs:
        r["proposal"] = proposal(r)
    recs.sort(key=lambda r: -r["score"]["auto"])
    out = build_report(recs, meta, args.out)
    log(f"report written: {out}")
    return out


# ----------------------------------------------------------------- local server with a Generate button
HOME = """<!doctype html><html><head><meta charset=utf-8><title>Submissions report</title>
<style>body{font:15px system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1rem;color:#1f1e1d;background:#faf9f5}
button,a.b{font:inherit;background:#1f1e1d;color:#fff;border:0;border-radius:8px;padding:.7rem 1.1rem;cursor:pointer;text-decoration:none;display:inline-block}
pre{background:#fff;border:1px solid #ddd;border-radius:8px;padding:.8rem;max-height:22rem;overflow:auto;font-size:12px;white-space:pre-wrap}
@media(prefers-color-scheme:dark){body{background:#1f1e1d;color:#f0eee6}pre{background:#2b2a27;border-color:#444;color:#ddd}button,a.b{background:#f0eee6;color:#1f1e1d}}</style></head>
<body><h1>Submissions to review</h1><p>Builds a report of the open google/fonts issues labelled <b>II Submission</b> in the
<b>Submissions to review</b> milestone. Read-only: nothing is posted to GitHub.</p>
<p><button id=go>Generate submission to review report</button> <a class=b id=last href=/report target=_blank hidden>Open last report</a></p>
<pre id=log>Idle.</pre>
<script>
const go=document.getElementById('go'),logEl=document.getElementById('log'),last=document.getElementById('last');
async function poll(){const s=await (await fetch('/status')).json();logEl.textContent=s.log.join('\\n')||'Idle.';last.hidden=!s.has_report;
 go.disabled=s.running;go.textContent=s.running?'Generating…':'Generate submission to review report';
 if(s.running){setTimeout(poll,1500)}else if(window.waiting&&s.has_report){window.waiting=false;window.open('/report?'+Date.now(),'_blank')}}
go.onclick=async()=>{window.waiting=true;await fetch('/start',{method:'POST'});poll()};
if(location.pathname==='/generate'){go.onclick()}else{poll()}
</script></body></html>"""


def serve(args, port):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    state = {"running": False}

    def worker():
        try:
            generate(args)
        except BaseException as e:
            log(f"ERROR: {e}")
        finally:
            state["running"] = False

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="text/html; charset=utf-8"):
            b = body.encode() if isinstance(body, str) else body
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            path = urllib.parse.urlparse(self.path).path
            if path in ("/", "/generate"):
                self.send(200, HOME)
            elif path == "/status":
                self.send(200, json.dumps({"running": state["running"], "log": LOG[-60:],
                                           "has_report": os.path.exists(args.out)}), "application/json")
            elif path == "/report" and os.path.exists(args.out):
                self.send(200, open(args.out, "rb").read())
            else:
                self.send(404, "not found", "text/plain")

        def do_POST(self):
            if urllib.parse.urlparse(self.path).path == "/start" and not state["running"]:
                state["running"] = True
                threading.Thread(target=worker, daemon=True).start()
            self.send(200, "{}", "application/json")

    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    url = f"http://127.0.0.1:{port}/"
    print(f"Submissions report tool running at {url}  (Ctrl+C to stop)")
    if not args.no_open:
        webbrowser.open(url)
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["serve", "generate"])
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--checker", default="auto", choices=["auto", "fontspector", "fontbakery", "none"])
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/gf-submissions"))
    ap.add_argument("--out")
    ap.add_argument("--issues-json")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument("--hosted", action="store_true", help="page served from a site that is rebuilt on a schedule")
    ap.add_argument("--update-url", help="link shown as 'Run an update now'")
    ap.add_argument("--no-submitter", action="store_true", help="don't fetch or show submitter profiles")
    ap.add_argument("--template", help="report template path")
    ap.add_argument("--gf", help="a local google/fonts clone, to find designers who already have families on Google Fonts")
    args = ap.parse_args()
    if args.gf:
        load_designer_index(args.gf)
    args.out = args.out or os.path.join(args.cache, "submissions_report.html")
    global TEMPLATE
    TEMPLATE = args.template
    for tool in ("git",) + (() if args.issues_json else ("gh",)):
        if not shutil.which(tool):
            raise SystemExit(f"{tool} is required")
    if args.command == "serve":
        serve(args, args.port)
    else:
        out = generate(args)
        if not args.no_open:
            webbrowser.open("file://" + os.path.abspath(out))


if __name__ == "__main__":
    main()
