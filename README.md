# Google Fonts issue dashboard

### → **[emmamarichal.github.io/gf-issues-dashboard](https://emmamarichal.github.io/gf-issues-dashboard/)**

A view of the open [google/fonts](https://github.com/google/fonts/issues) issues, rebuilt every hour.

- **[Issue triage](https://emmamarichal.github.io/gf-issues-dashboard/)**: issues by kind, font bugs by
  problem type and feasibility, QA status of each family, and issues that could probably be closed.
- **[Submissions to review](https://emmamarichal.github.io/gf-issues-dashboard/submissions.html)**: one
  card per *II Submission* issue in the *Submissions to review* milestone, with specimen, coverage,
  sources, licence, QA, outline quality, AI signals, a score and a to-do list.

Read-only: the build only reads from GitHub. It never comments, labels or opens pull requests.

## How it works

A GitHub Actions workflow (`.github/workflows/build.yml`) runs every hour, on each push to `main` and
from **Actions → Build dashboard → Run workflow**. It reads the issues, analyses them, and publishes the
pages to GitHub Pages. When a page opens, it also checks GitHub for issues closed or added since the
last build. No secret is needed: the workflow's own `GITHUB_TOKEN` reads the public data.

## Correcting the classification

Add a line to `pipeline/overrides.txt` and commit:

```
11120 OUTL          # problem type: OUTL NAME VF VMET OTF DIAC MISSACC REND GLY MISS SPC SHAP INTP DES APP COLL OTH
2077 K:api          # kind: K:upgrade K:api K:request K:tools K:new
8288 F:ofl/inter    # family the issue is about
```

## Run locally

```bash
pip install -r requirements.txt
python pipeline/build.py          # needs gh logged in; options: --skip-qa --skip-submissions --no-submitter
python -m http.server -d site 8000
```

QA uses fontspector when installed, otherwise fontbakery (googlefonts profile, network checks ignored).
Outline quality and AI signals are heuristics to help a reviewer, not verdicts.