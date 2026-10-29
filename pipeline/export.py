"""Flatten triage + QA into the site's data files, plus the font catalogue used by the proof tool."""
import datetime as dt, json, os, re


def display_name(filename):
    stem = re.split(r"[\[-]", filename.rsplit(".", 1)[0])[0]
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", stem.replace("_", " "))


def catalogue(work, site_data):
    """Every family in ofl/, apache/, ufl/ with its font files: [[dir, name, [files]]]."""
    fams = {}
    for line in open(os.path.join(work, "current_font_files.txt")):
        line = line.strip()
        if line.count("/") == 2:
            d, fn = line.rsplit("/", 1)
            fams.setdefault(d, []).append(fn)
    rows = [[d, display_name(sorted(fs)[0]), sorted(fs)] for d, fs in sorted(fams.items())]
    json.dump(rows, open(os.path.join(site_data, "catalogue.json"), "w"), separators=(",", ":"))
    return len(rows)


def run(work, site_data, extra_meta=None):
    t = json.load(open(os.path.join(work, "triage.json")))
    qp = os.path.join(work, "qa_results.json")
    fs = json.load(open(qp)) if os.path.exists(qp) else {}
    issues, close = [], []
    for o in t:
        fam = o["family"] or ""
        spec = fs.get(fam) if fam else None
        if o["kind"] != "Font bug" or o["fixability"] not in ("High", "Medium"):
            spec_status, spec_fails, spec_checks = "", None, ""
        elif not spec or spec.get("error"):
            spec_status, spec_fails, spec_checks = "Not checked", None, ""
        else:
            spec_fails, spec_status, spec_checks = spec["fail"], spec["verdict"], ", ".join(spec["fail_checks"])
        likely = [c for c in o["close"] if c["confidence"] == "likely"]
        issues.append({
            "number": o["number"], "title": o["title"], "url": o["url"], "kind": o["kind"],
            "category": o["category"] or "", "fixability": o["fixability"] or "",
            "fix_notes": "; ".join(o["fix_reasons"]), "priority": o["priority"] or "",
            "priority_score": o["priority_score"], "family": fam.split("/")[-1] if fam else "",
            "family_path": fam, "opened": o["created"], "year_opened": int(o["created"][:4]),
            "last_activity": o["updated"], "idle_days": o["idle_days"], "comments": o["comments"],
            "reactions": o["reactions"], "labels": ", ".join(o["labels"]), "milestone": o["milestone"] or "",
            "assignees": ", ".join(o["assignees"]),
            "spec_status": spec_status, "spec_fails": spec_fails, "spec_fail_checks": spec_checks,
            "close_status": "Likely" if likely else ("To verify" if o["close"] else ""),
        })
        for k, c in enumerate(o["close"]):
            close.append({
                "id": f'{o["number"]}-{k}', "number": o["number"], "title": o["title"], "url": o["url"],
                "kind": o["kind"], "reason": c["reason"], "confidence": "Likely" if c["confidence"] == "likely" else "To verify",
                "evidence": c["evidence"], "commit": c["commit"] or "", "last_activity": o["updated"],
                "comments": o["comments"], "reactions": o["reactions"],
            })
    os.makedirs(site_data, exist_ok=True)
    json.dump(issues, open(os.path.join(site_data, "issues_triage.json"), "w"), separators=(",", ":"))
    json.dump(close, open(os.path.join(site_data, "close_candidates.json"), "w"), separators=(",", ":"))
    meta = {"built": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "issues": len(issues),
            "qa_families": len(fs), "catalogue_families": catalogue(work, site_data)}
    meta.update(extra_meta or {})
    json.dump(meta, open(os.path.join(site_data, "meta.json"), "w"), indent=1)
    return meta
