"""Classify open google/fonts issues: kind, problem category, fixability, priority, close candidates.

Rules on labels and text, plus hand-reviewed corrections in overrides.txt
(one per line: "<issue> <CODE>", "<issue> K:<kind>" or "<issue> F:<ofl/family>").
Inputs (in WORK): issues.json, family_history.json, current_families.txt, current_font_files.txt,
commit_refs.json. Output: WORK/triage.json
"""
import json, os, re, datetime as dt, collections

HERE = os.path.dirname(os.path.abspath(__file__))


def run(work):
  global NOW, issues, hist, current, COMMIT_REFS, FILES, overrides, dir_by_key
  NOW = dt.datetime.now(dt.timezone.utc)
  issues = json.load(open(os.path.join(work, "issues.json")))
  hist = json.load(open(os.path.join(work, "family_history.json")))
  current = set(l.strip() for l in open(os.path.join(work, "current_families.txt")) if l.strip())
  COMMIT_REFS = json.load(open(os.path.join(work, "commit_refs.json")))
  FILES = collections.defaultdict(list)
  for line in open(os.path.join(work, "current_font_files.txt")):
    p = line.strip().split("/")
    if len(p) > 2:
      FILES[p[0] + "/" + p[1]].append(p[-1])
  overrides = {}
  for line in open(os.path.join(HERE, "overrides.txt")):
    if not line.strip() or line.startswith("#"):
      continue
    n, code = line.split()
    d = overrides.setdefault(n, {})
    if code.startswith("K:"):
      d["kind"] = KIND_CODES[code[2:]]
    elif code.startswith("F:"):
      d["family"] = code[2:]
    else:
      d["code"] = code
  dir_by_key = {}
  for k in list(hist["last_any"].keys()) + list(current):
    lic, name = k.split("/")
    if name not in dir_by_key or k in current:
      dir_by_key[name] = k
  out = [triage_one(i) for i in issues]
  json.dump(out, open(os.path.join(work, "triage.json"), "w"), indent=1)
  return out

CATS = {  # code: (name, base fixability, user-visible severity 1-3)
    "OUTL": ("Outline flags / contours", "High", 3),
    "NAME": ("Font tables & metadata", "High", 2),
    "VF": ("Variable font tables", "High", 2),
    "VMET": ("Vertical metrics / baseline", "Medium", 3),
    "OTF": ("OpenType features & layout tables", "Medium", 2),
    "DIAC": ("Diacritic / mark positioning", "Medium", 2),
    "MISSACC": ("Missing accented letters", "Medium", 2),
    "REND": ("Hinting / rendering", "Medium", 2),
    "GLY": ("Wrong or broken glyph", "Low", 2),
    "MISS": ("Missing glyphs / coverage", "Low", 2),
    "SPC": ("Spacing / kerning", "Low", 1),
    "SHAP": ("Complex-script shaping", "Low", 2),
    "INTP": ("Interpolation", "Low", 1),
    "DES": ("Glyph design", "Low", 1),
    "APP": ("App / OS-specific report", "Low", 1),
    "COLL": ("Collection-wide task", "Low", 1),
    "OTH": ("Unclear report", "Low", 1),
}
KIND_CODES = {"upgrade": "Font upgrade request", "api": "API / website / platform", "request": "Request",
              "tools": "Tools / workflow / repo", "new": "New font / submission"}

def ts(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))

# ---------- family matching ----------
AMBIGUOUS = {"play", "ultra", "metal", "prompt", "outfit", "average", "stick", "sail", "sedan", "geo",
             "vast", "explora", "recursive", "offside", "smooch", "monoton", "fresca", "gloock", "kite",
             "anybody", "sniglet", "creepster", "jura", "bungee", "asset", "hanuman", "federo", "imprima",
             "inconsolata", "carme", "manuale", "trirong", "piazzolla", "fasthand", "zeyada", "sunflower",
             "headlandone", "yesteryear", "tienne", "nova", "copse", "ruge", "unna", "coda", "galada",
             "rasa", "mako", "molle", "hind", "teko", "sora", "radley", "chango", "changa", "cardo",
             "bitter", "domine", "kreon", "nobile", "tinos", "arimo", "cousine", "ubuntu", "roboto", "inter",
             "lato", "oswald", "rubik", "lora", "jost", "exo", "acme", "abel", "amiri", "allan", "gelasio"}
# names that are real families but also common words: only accept when written Capitalised
COMMON_WORDS = {"play", "ultra", "metal", "prompt", "outfit", "average", "stick", "sail", "sedan", "vast",
                "offside", "smooch", "anybody", "asset", "nova", "allan", "acme", "abel", "bitter", "chango",
                "code", "sans", "serif", "mono", "display", "text", "one", "two", "font", "fonts", "google",
                "icons", "material", "emoji", "symbols", "variable", "italic", "bold", "regular", "add",
                "update", "new", "basic", "big", "fira", "source", "noto", "open", "ibm"}

def find_family(title, body):
    words = re.findall(r"[A-Za-z0-9]+", title)
    best = None
    for n in range(6, 0, -1):
        for s in range(len(words) - n + 1):
            seg = words[s:s + n]
            key = "".join(seg).lower()
            if key in dir_by_key:
                if n == 1 and (key in COMMON_WORDS or not seg[0][0].isupper()):
                    continue
                best = dir_by_key[key]
                break
        if best:
            break
    if not best:  # "Font: Baloo 2" style headers in body
        m = re.search(r"(?im)^\s*\**(?:font|family|font family)\**\s*[:：]\s*\**([A-Za-z0-9 ]{2,40})", body or "")
        if m:
            key = re.sub(r"[^a-z0-9]", "", m.group(1).split(",")[0].lower())
            for cut in range(len(key), 2, -1):
                if key[:cut] in dir_by_key:
                    best = dir_by_key[key[:cut]]
                    break
    return best

# ---------- classification ----------
LBL_KIND = [
    ("New font / submission", {"I New Font", "II Submission", "II Accepted", "II Commissioned", "X None requirements met", "X Not OFL Libre Font"}),
    ("API / website / platform", {"I API / Website / Platform", "I UX/UI Suggestion", "I Designer profile", "I Article/Description"}),
    ("Tools / workflow / repo", {"I Tools / workflow / repo", "Tag tool / Tags definition", "agentic-workflows", "dependencies", "I Axis Registry"}),
    ("Font upgrade request", {"I Font Upgrade", "III Expand glyphset", "III Expand styles", "III VF Replacement"}),
    ("Font bug", {"I Font Bug", "I Small Fix", "-- Bad rendering", "-- Regressions", "I Metadata/OFL"}),
    ("Request", {"I Request", "I Lang", "I Knowledge"}),
]

def rx(*words):
    return re.compile("|".join(words), re.I)

# Ordered: first match wins. (category, regex, base fixability)
BUG_CATS = [  # regex fallback for issues not reviewed by hand (first match wins)
    ("NAME", rx(r"\bname ?table", r"family name", r"style name", r"\bname id", r"nameid", r"usweightclass", r"weight class",
                r"fsselection", r"metadata", r"achvendid", r"copyright", r"license", r"font ?revision", r"isfixedpitch",
                r"\bpanose", r"italicangle", r"post table", r"macstyle", r"underline", r"\bos/?2\b", r"fstype")),
    ("OUTL", rx(r"overlap", r"contour", r"bulg", r"path direction", r"overlap_simple", r"component (glyph )?flag", r"bbox")),
    ("VF", rx(r"\bstat\b", r"\bfvar\b", r"\bavar\b", r"named instance", r"\bslnt\b", r"axis (value|range|default)", r"default instance")),
    ("VMET", rx(r"clip", r"cut ?off", r"line[- ]height", r"vertical metric", r"winascent", r"typoascender", r"\bhhea\b", r"line spacing")),
    ("SHAP", rx(r"devanagari", r"bengali", r"gujarati", r"telugu", r"tamil", r"kannada", r"malayalam", r"arabic", r"urdu", r"khmer",
                r"thai", r"myanmar", r"hebrew", r"conjunct", r"shaping", r"matra")),
    ("DIAC", rx(r"accent", r"diacritic", r"\bmarks?\b", r"anchor", r"combining", r"ogonek", r"caron", r"cedilla", r"macron", r"umlaut")),
    ("MISS", rx(r"missing", r"lack", r"tofu", r"not supported", r"\bnotdef\b", r"\bu\+[0-9a-f]{4}")),
    ("OTF", rx(r"\bfeature", r"\bliga", r"ligature", r"small ?caps", r"\btnum\b", r"\bss0\d", r"stylistic", r"\blocl\b", r"\bgsub\b", r"\bgpos\b")),
    ("SPC", rx(r"kern", r"spacing", r"sidebearing", r"advance width", r"\bwidth")),
    ("REND", rx(r"hint", r"render", r"blurr", r"pixel", r"cleartype", r"\bgasp\b")),
    ("INTP", rx(r"interpolat", r"\bkink", r"wobbl")),
    ("APP", rx(r"windows", r"macos", r"mac os", r"\bios\b", r"android", r"word\b", r"powerpoint", r"illustrator", r"indesign",
               r"photoshop", r"chrome", r"firefox", r"safari", r"\bedge\b", r"print", r"\bpdf\b", r"install")),
    ("GLY", rx(r"wrong", r"incorrect", r"broken", r"glyph", r"character")),
]
BUGGY_WORDS = rx(r"\bbug\b", r"broken", r"issue", r"problem", r"wrong", r"incorrect", r"missing", r"not (work|render|display)", r"render", r"error", r"glitch")


def classify(i):
    labels = {l["name"] for l in i["labels"]}
    kind = None
    for name, s in LBL_KIND:
        if labels & s:
            kind = name
            break
    text_title = i["title"] or ""
    text = text_title + "\n" + (i["body"] or "")[:3000]
    if kind is None:
        if re.search(r"^\s*(add|submit|new font|onboard)\b|font submission|please add", text_title, re.I):
            kind = "New font / submission"
        elif re.search(r"\b(api|css2?|website|fonts\.google\.com|specimen|download|webfont|url|http|endpoint|search|filter)\b", text_title, re.I):
            kind = "API / website / platform"
        elif re.search(r"\b(update|upgrade)\b", text_title, re.I):
            kind = "Font upgrade request"
        elif re.search(r"\b(ci|github action|bot|repo|gftools|fontbakery|fontspector|pr)\b", text_title, re.I):
            kind = "Tools / workflow / repo"
        elif BUGGY_WORDS.search(text_title) or any(c[1].search(text_title) for c in BUG_CATS):
            kind = "Font bug"
        else:
            kind = "Request"
    ov = overrides.get(str(i["number"]), {})
    kind = ov.get("kind", "Font bug" if "code" in ov else kind)
    cat = fix = code = None
    if kind == "Font bug":
        code = ov.get("code")
        if not code:
            for c, r in BUG_CATS:
                if r.search(text_title):
                    code = c; break
        if not code:
            for c, r in BUG_CATS:
                if r.search(text):
                    code = c; break
        code = code or "OTH"
        cat, fix = CATS[code][0], CATS[code][1]
    i["_code"] = code
    i["_reviewed"] = "code" in ov or "kind" in ov
    return kind, cat, fix, labels

def fixability(kind, base, labels, fam):
    """High / Medium / Low / Blocked, with reasons."""
    if kind != "Font bug":
        return None, []
    reasons = []
    level = base
    if "I Small Fix" in labels:
        level, _ = "High", reasons.append("labelled I Small Fix")
    if "-- Needs design work" in labels:
        level, _ = "Low", reasons.append("labelled Needs design work")
    if labels & {"-- Needs language expertise"}:
        level = "Low" if level == "High" else level
        reasons.append("needs language expertise")
    if labels & {"-- Needs Upstream Resolution", "-- Upstream is working on it"}:
        level = "Blocked"
        reasons.append("waiting on upstream")
    if labels & {"-- Needs Eng team opinion", "-- Needs manager's opinion", "-- Needs confirmation"}:
        reasons.append("needs a decision first")
        if level == "High":
            level = "Medium"
    if "X Missing sources" in labels:
        reasons.append("no sources: binary-only fix")
    if "X Has RFN" in labels:
        reasons.append("Reserved Font Name: check before modifying")
    if fam is None:
        reasons.append("family not identified")
    elif fam not in current:
        reasons.append("family no longer in repo")
    return level, reasons

def name_matches_title(title, fam, strict=False):
    """True when the family name is the subject of the title, not a prefix of a longer name
    (e.g. 'Rubik Bubble' must not match ofl/rubik, 'Google Sans Mono' must not match ofl/googlesans)."""
    key = fam.split("/")[1]
    t = re.sub(r"^\s*\W*(add|new font|submit|submission|update|upgrade|onboard)\b\W*", "", title, flags=re.I)
    words = re.findall(r"[A-Za-z0-9]+", t)
    for s in range(len(words)):
        acc = ""
        for e in range(s, len(words)):
            acc += words[e].lower()
            if acc == key:
                nxt = words[e + 1] if e + 1 < len(words) else ""
                if strict:
                    return s == 0 and (not nxt or not nxt[:1].isupper() or nxt.lower() in ("font", "fonts", "family", "typeface", "v", "to", "with", "by", "from"))
                return not (nxt[:1].isupper() and nxt.lower() not in ("font", "fonts", "family", "typeface", "vf", "variable", "to", "with", "by"))
            if len(acc) > len(key):
                break
    return False

def triage_one(i):
    kind, cat, base, labels = classify(i)
    fam = overrides.get(str(i["number"]), {}).get("family") or find_family(i["title"], i["body"])
    created, updated = ts(i["created_at"]), ts(i["updated_at"])
    age_days = (NOW - created).days
    idle_days = (NOW - updated).days
    fix, fix_reasons = fixability(kind, base, labels, fam)
    thumbs = i["reactions"].get("+1", 0)
    reactions = i["reactions"].get("total_count", 0)
    # ---- family history facts ----
    fam_last = hist["last_binary"].get(fam) if fam else None
    fam_first = hist["first"].get(fam) if fam else None
    updated_since = bool(fam_last and ts(fam_last[0]) > created)
    added_after = bool(fam_first and ts(fam_first[0]) > created)
    # ---- priority (bugs only) ----
    prio_score, prio = None, None
    if kind == "Font bug":
        sev = CATS[i["_code"]][2]
        demand = min(thumbs + reactions, 20) * 1.0 + min(i["comments"], 20) * 0.3
        recency = 2 if idle_days < 365 else (1 if idle_days < 3 * 365 else 0)
        explicit = {"P1": 6, "P2": 4, "P3": 2, "P4": 1}
        exp = max([explicit[l] for l in labels if l in explicit] or [0])
        planned = 1 if (i.get("milestone") or {}).get("title", "").startswith(("2026", "2027")) else 0
        prio_score = round(sev * 2 + demand + recency + exp + planned, 1)
        prio = "High" if prio_score >= 10 else ("Medium" if prio_score >= 6 else "Low")
    # ---- close candidates ----
    close = []
    # Any issue about one specific font whose binaries were re-shipped after the issue was opened.
    # (New-font issues are handled by the onboarding rule below; collection-wide tasks are not about one font.)
    if updated_since and fam in current and kind != "New font / submission" and i["_code"] != "COLL":
        days_after = (ts(fam_last[0]) - created).days
        wants_vf = re.search(r"\b(vf|variable|axis|axes)\b", i["title"], re.I)
        has_vf = any("[" in f for f in FILES.get(fam, []))
        upgrade_ok = kind != "Font upgrade request" or name_matches_title(i["title"], fam)
        asks_feature = kind in ("Font upgrade request", "Request")
        wants_italic = re.search(r"\b(italic|oblique)s?\b", i["title"], re.I)
        has_italic = any("italic" in f.lower() for f in FILES.get(fam, []))
        still_missing = asks_feature and ((wants_vf and not has_vf) or (wants_italic and not has_italic))
        if upgrade_ok and not still_missing:
            close.append(("Font updated since the issue was opened", "likely",
                          f"{fam} binaries updated {fam_last[0][:10]}, {days_after} days after the issue was opened ({i['created_at'][:10]})",
                          fam_last[1]))
    if kind == "New font / submission" and fam in current and added_after and name_matches_title(i["title"], fam, strict=True) \
            and re.search(r"\b(add|missing|request|submit|new font|onboard)", i["title"], re.I):
        close.append(("Font now onboarded", "likely",
                      f"{fam} added {fam_first[0][:10]}, after the issue was opened", fam_first[1]))
    if fam and fam not in current and fam in hist["last_any"] and hist["last_any"][fam][0][:10] > i["created_at"][:10]:
        close.append(("Family removed from the repo", "likely",
                      f"{fam} no longer exists in google/fonts (last seen {hist['last_any'][fam][0][:10]})", hist['last_any'][fam][1]))
    if labels & {"X None requirements met", "X Not OFL Libre Font"}:
        close.append(("Submission does not meet requirements", "likely", "labelled " + ", ".join(sorted(labels & {"X None requirements met", "X Not OFL Libre Font"})), None))
    for d, h, msg in COMMIT_REFS.get(str(i["number"]), []):
        if d[:10] < i["created_at"][:10] or re.search(r"\(#%d\)" % i["number"], msg):
            continue  # older than the issue, or a squash-merge suffix "(#N)" that names a PR from a merged subtree
        strong = re.search(r"(fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\W+#%d\b" % i["number"], msg, re.I) \
            and len(re.findall(r"#\d+", msg)) == 1
        close.append(("Commit references this issue", "likely" if strong else "verify",
                      f"commit {d[:10]}: “{msg[:100]}”", h))
    if "-- Author is unresponsive/unreachable" in labels and idle_days > 180:
        close.append(("Author unresponsive", "likely", f"no activity for {idle_days} days", None))
    if not close and idle_days > 3 * 365 and kind in ("API / website / platform", "Tools / workflow / repo", "Request") and i["comments"] <= 2 and reactions <= 2:
        close.append(("Stale, little interest", "verify", f"no activity for {idle_days // 365} years, {i['comments']} comment(s), {reactions} reaction(s)", None))
    return {
        "number": i["number"], "title": i["title"], "url": i["html_url"], "created": i["created_at"][:10],
        "updated": i["updated_at"][:10], "age_days": age_days, "idle_days": idle_days, "comments": i["comments"],
        "thumbs_up": thumbs, "reactions": reactions, "labels": sorted(labels),
        "milestone": (i.get("milestone") or {}).get("title"), "assignees": [a["login"] for a in i["assignees"]],
        "author": i["user"]["login"], "kind": kind, "reviewed": i["_reviewed"], "category": cat, "fixability": fix, "fix_reasons": fix_reasons,
        "family": fam, "family_in_repo": fam in current if fam else None,
        "family_last_update": fam_last[0][:10] if fam_last else None, "family_updated_since": updated_since,
        "priority_score": prio_score, "priority": prio,
        "close": [{"reason": c[0], "confidence": c[1], "evidence": c[2],
                   "commit": f"https://github.com/google/fonts/commit/{c[3]}" if c[3] else None} for c in close],
    }

