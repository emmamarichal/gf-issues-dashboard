"""QA (googlefonts profile) on the families of fixable font bugs, cached per family commit.

Uses fontspector when installed, otherwise fontbakery. Network-dependent checks are ignored so
results are stable. Output: WORK/qa_results.json  {family: {fail, fail_checks, verdict}}
"""
import concurrent.futures as cf, json, os, shutil, subprocess, time

from gf_submissions import parse_any_report

COVERAGE = {"googlefonts/glyph_coverage", "googlefonts/glyphsets/shape_languages", "googlefonts/family/equal_codepoint_coverage"}
DESIGN = {"mandatory_glyphs", "case_mapping", "dotted_circle", "legacy_accents", "alt_caron", "contour_count",
          "base_has_width", "rupee", "arabic_spacing_symbols", "whitespace_ink", "control_chars",
          "smallcaps_before_ligatures", "tabular_kerning"}
METRICS = {"googlefonts/use_typo_metrics", "family/win_ascent_and_descent", "os2_metrics_match_hhea",
           "family/vertical_metrics", "linegaps", "opentype/maxadvancewidth", "opentype/monospace",
           "whitespace_widths", "opentype/family/underline_thickness", "opentype/italic_angle"}


def verdict(fails):
    if not fails:
        return "No FAIL"
    if fails & DESIGN:
        return "Glyph fixes needed"
    if fails & COVERAGE:
        return "Glyphset coverage incomplete"
    if fails & METRICS:
        return "Metrics to review"
    return "Scriptable FAILs only"


def candidates(triage):
    return sorted({o["family"] for o in triage if o["kind"] == "Font bug" and o["fixability"] in ("High", "Medium")
                   and o["family"] and o["family_in_repo"]})


def checkout(gf, families):
    subprocess.run(["git", "-C", gf, "sparse-checkout", "set", "--no-cone", "/README.md"] + [f"/{f}/" for f in families],
                   check=True, capture_output=True)
    subprocess.run(["git", "-C", gf, "checkout", "-q", "main"], check=True, capture_output=True, timeout=1800)
    subprocess.run(["git", "-C", gf, "merge", "-q", "--ff-only", "origin/main"], capture_output=True, timeout=1800)


def check_one(gf, fam, sha, cache_dir, timeout, deadline=None):
    key = os.path.join(cache_dir, fam.replace("/", "__") + "__" + (sha or "none")[:12] + ".json")
    if os.path.exists(key):
        return fam, json.load(open(key))
    if deadline is not None:
        left = deadline - time.monotonic()
        if left < 60:
            return fam, {"error": "not checked yet (time budget of this build used up)", "retry": True}
        timeout = int(min(timeout, left))
    d = os.path.join(gf, fam)
    files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith((".ttf", ".otf"))) if os.path.isdir(d) else []
    if not files:
        return fam, {"error": "no font files"}
    tmp = key + ".tmp"
    rep, why = None, "QA did not run"
    try:
        if shutil.which("fontspector"):
            subprocess.run(["fontspector", "--profile", "googlefonts", "--json", tmp] + files, capture_output=True, timeout=timeout)
            if os.path.exists(tmp):
                rep = parse_any_report(json.load(open(tmp)), "fontspector")
        if rep is None and shutil.which("fontbakery"):
            subprocess.run(["fontbakery", "check-googlefonts", "-l", "FAIL", "--json", tmp] + files,
                           capture_output=True, timeout=timeout)
            if os.path.exists(tmp):
                rep = parse_any_report(json.load(open(tmp)), "fontbakery")
    except subprocess.TimeoutExpired:
        why = f"QA took longer than {timeout // 60} minutes"
    except (OSError, ValueError) as e:
        why = f"QA failed: {e}"
    if os.path.exists(tmp):
        os.remove(tmp)
    if rep is None:
        res = {"error": why}
        if deadline is None or time.monotonic() < deadline - 30:  # a timeout caused by the budget is retried next build
            json.dump(res, open(key, "w"))  # cached too: retried only when the family changes
        return fam, res
    fails = set(rep["fail"])
    res = {"fail": len(fails), "fail_checks": sorted(fails), "verdict": verdict(fails), "tool": rep["tool"]}
    json.dump(res, open(key, "w"))
    return fam, res


def run(gf, work, cache_dir, jobs=4, timeout=900, deadline=None):
    """deadline (time.monotonic): families not checked by then are left for the next build."""
    triage = json.load(open(os.path.join(work, "triage.json")))
    hist = json.load(open(os.path.join(work, "family_history.json")))
    fams = candidates(triage)
    os.makedirs(cache_dir, exist_ok=True)
    checkout(gf, fams)
    out = {}
    with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = [ex.submit(check_one, gf, f, (hist["last_binary"].get(f) or [None, None])[1], cache_dir, timeout, deadline) for f in fams]
        for fu in cf.as_completed(futs):
            try:
                fam, res = fu.result()
            except Exception as e:  # a timeout on one family must not stop the build
                continue
            out[fam] = res
    json.dump(out, open(os.path.join(work, "qa_results.json"), "w"), indent=1)
    return out
