# Google Fonts issue dashboard

A dashboard of the open [google/fonts](https://github.com/google/fonts/issues) issues, rebuilt every hour
by GitHub Actions and published with GitHub Pages.

- **Issue triage** (`index.html`): open issues by kind, font bugs by problem type and feasibility, the
  googlefonts-profile QA status of each family, and issues that could probably be closed.
- **Submissions to review** (`submissions.html`): one card per open issue labelled *II Submission* in the
  *Submissions to review* milestone, with a live specimen, glyphset and language coverage, sources,
  licence and RFN, QA, outline quality, AI signals, submitter history, a score, a draft comment and a
  to-do checklist.

Everything this repository does on GitHub is **read-only** (REST GET requests and `git clone`). It never
comments, labels, assigns or opens pull requests.

## Set up (once)

1. Push this folder to the repository's `main` branch.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Actions → Build dashboard → Run workflow.** The first run takes 30–60 minutes (QA on about 90
   families and 50 submission repos). Later runs reuse cached results and take a few minutes.
4. The site is at `https://<user>.github.io/<repo>/`.

No secret or personal token is needed: the workflow's own `GITHUB_TOKEN` can read public data.

## How it stays current

- The workflow runs every hour (`cron: "17 * * * *"`), on every push to `main`, and from the
  **Run workflow** button (linked from both pages as "Run an update now").
- When a page opens, it also asks GitHub (1–3 requests, no token) which issues changed since the last
  build: closed issues are removed from the figures straight away, new ones are listed, and submissions
  that were closed, accepted or moved out of the milestone are marked as having left the queue.

## Layout

```
.github/workflows/build.yml   hourly build + Pages deploy
pipeline/build.py             runs every step
pipeline/history.py           family facts from a blobless clone of google/fonts
pipeline/triage.py            classification rules: kind, problem type, feasibility, priority, closing candidates
pipeline/overrides.txt        hand-reviewed corrections, one per line (see below)
pipeline/qa.py                googlefonts-profile QA on the families of fixable bugs, cached per family commit
pipeline/export.py            data files for the dashboard
pipeline/gf_submissions.py    submissions report (also usable locally: python pipeline/gf_submissions.py serve)
pipeline/submissions_template.html
site/index.html               dashboard page
site/assets/                  d3 and the small loader the page uses
```

## Correcting the classification

Edit `pipeline/overrides.txt`, one issue per line:

```
11120 OUTL          # problem type code (OUTL, NAME, VF, VMET, OTF, DIAC, MISSACC, REND, GLY, MISS, SPC, SHAP, INTP, DES, APP, COLL, OTH)
2077 K:api          # kind: K:upgrade, K:api, K:request, K:tools, K:new
8288 F:ofl/inter    # family the issue is about
```

Commit to `main`: the site is rebuilt with the change.

## Run it locally

```bash
pip install -r requirements.txt
gh auth login
python pipeline/build.py            # writes site/ (open site/index.html through a local server)
python -m http.server -d site 8000
```

Options: `--skip-qa`, `--skip-submissions`, `--no-submitter` (hide submitter profiles), `--jobs N`.

## Notes

- QA uses fontspector when it is installed, otherwise fontbakery 1.1 (same googlefonts profile).
  Checks that depend on network services are ignored. A family whose QA takes more than 15 minutes is
  marked "Not checked" until it changes.
- Outline quality and AI signals are heuristics meant to help a human reviewer, not verdicts.
- Moving to google.github.io/fonts later: the existing dashboard in `google/fonts/.ci/dashboard` copies
  standalone `.ci/*.html` pages into its build, so these pages and the pipeline can be added there.
