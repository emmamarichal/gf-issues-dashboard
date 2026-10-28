#!/usr/bin/env python3
"""Build the whole site: issue triage dashboard + submissions report.

  python pipeline/build.py                       # everything, live from GitHub (needs GH_TOKEN for gh)
  python pipeline/build.py --issues-json FILE    # take open issues from an export instead
  python pipeline/build.py --skip-qa --skip-submissions

Everything on GitHub is read-only: REST GET requests and git clones.
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gf_submissions as subs  # noqa: E402
import history, triage, qa, export  # noqa: E402


def step(name):
    print(f"\n=== {name}  ({time.strftime('%H:%M:%S')})", flush=True)


def clone_gf(gf):
    if os.path.isdir(os.path.join(gf, ".git")):
        subprocess.run(["git", "-C", gf, "fetch", "-q", "origin", "main"], check=True)
    else:
        subprocess.run(["git", "clone", "-q", "--filter=blob:none", "--no-checkout",
                        "https://github.com/google/fonts", gf], check=True)


def fetch_issues(work, issues_json):
    if issues_json:
        txt = open(issues_json).read().strip().replace("]\n[", ",").replace("][", ",")
        items = json.loads(txt)
    else:
        items = subs.gh_get("repos/google/fonts/issues", paginate=True, state="open", per_page="100") or []
        if not items:
            raise SystemExit("Could not read google/fonts issues (is GH_TOKEN set?)")
    items = [i for i in items if "pull_request" not in i and i.get("state", "open") == "open"]
    json.dump(items, open(os.path.join(work, "issues.json"), "w"))
    return items


def main():
    root = os.path.dirname(HERE)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--gf", default=os.path.join(root, ".cache", "google-fonts"), help="google/fonts clone (created if missing)")
    ap.add_argument("--work", default=os.path.join(root, ".cache", "work"))
    ap.add_argument("--cache", default=os.path.join(root, ".cache"))
    ap.add_argument("--site", default=os.path.join(root, "site"))
    ap.add_argument("--issues-json")
    ap.add_argument("--skip-qa", action="store_true")
    ap.add_argument("--skip-submissions", action="store_true")
    ap.add_argument("--no-submitter", action="store_true", help="hide submitter profiles in the submissions report")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--update-url", default=os.environ.get("UPDATE_URL", ""))
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)

    step("google/fonts history")
    clone_gf(a.gf)
    print(history.build(a.gf, a.work))

    step("open issues")
    print(len(fetch_issues(a.work, a.issues_json)), "open issues")

    step("triage")
    t = triage.run(a.work)
    print(len(t), "issues classified")

    if not a.skip_qa:
        step("QA on fixable bugs")
        res = qa.run(a.gf, a.work, os.path.join(a.cache, "qa"), jobs=a.jobs)
        print(len(res), "families checked")

    step("export")
    meta = export.run(a.work, os.path.join(a.site, "data"), {"update_url": a.update_url})
    print(meta)

    if not a.skip_submissions:
        step("submissions report")
        sargs = argparse.Namespace(jobs=a.jobs, checker="auto", cache=os.path.join(a.cache, "gf-submissions"),
                                   out=os.path.join(a.site, "submissions.html"), issues_json=a.issues_json,
                                   hosted=True, update_url=a.update_url, no_submitter=a.no_submitter, no_open=True)
        subs.TEMPLATE = os.path.join(HERE, "submissions_template.html")
        subs.generate(sargs)


if __name__ == "__main__":
    main()
