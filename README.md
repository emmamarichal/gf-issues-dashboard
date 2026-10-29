# Google Fonts tools

### → **[emmamarichal.github.io/gf-issues-dashboard](https://emmamarichal.github.io/gf-issues-dashboard/)**

Small tools for the people who triage, review and onboard fonts for [Google Fonts](https://github.com/google/fonts). They run on GitHub Pages; nothing needs installing.

| Tool | What it is for | Open |
| --- | --- | --- |
| **GF Issue Dashboard** | See what is in the google/fonts issue backlog, what can be fixed without design work, and what could be closed. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/) |
| ↳ Submissions to review | Review every pending font submission from one page, with a score and a to-do list per font. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/submissions.html) |
| **Typo Guide Generator** | Turn a font review into a short checklist to post on the GitHub issue, with a link to the full report (resources, tutorials, Fontspector, screenshots). | [Open](https://emmamarichal.github.io/gf-issues-dashboard/typo-guide/) |
| **Reference proofs** | Compare a font with Google Fonts families of the same script, glyph by glyph and in text. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/reference-proofs/) |
| **Font Social Post Generator** | Draft the social post announcing a new family, with its images, always crediting the designer. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/social-posts/) |
| **Plans** | Proposals for tools that are not built yet. | [tool-plans/](tool-plans/) |

None of the tools acts on GitHub by itself: no comment, label or pull request is posted unless a person does it.

## Triage and onboarding

### GF Issue Dashboard

**[Open the dashboard](https://emmamarichal.github.io/gf-issues-dashboard/)** · code in [`pipeline/`](pipeline/) and [`site/index.html`](site/index.html)

The open google/fonts issues, rebuilt every hour. It answers three questions:

- **What is in the backlog?** Issues by kind (font bug, submission, upgrade, API, request…) and font bugs by problem type, with age and activity.
- **What can be fixed quickly?** Each font bug gets a feasibility rating (can a script fix it, without design work?) and a priority. For the fixable ones, the shipped binaries are checked with the googlefonts profile, because a family that already fails other checks cannot take a simple hotfix.
- **What could be closed?** Issues about a font that has been updated since the issue was opened, issues a commit says it fixes, and old issues with no interest. Nothing is closed automatically: each one comes with the evidence to check.

When the page opens, it also asks GitHub which issues were closed or opened since the last build, so the figures stay current between builds.

### Submissions to review

**[Open the report](https://emmamarichal.github.io/gf-issues-dashboard/submissions.html)**, or use **Generate submission to review report** on the dashboard · code in [`pipeline/gf_submissions.py`](pipeline/gf_submissions.py)

One card per issue labelled *II Submission* in the *Submissions to review* milestone, to decide on each font quickly:

- specimen, links to the issue and the source repository;
- glyphsets and languages covered, source format (.glyphs, UFO…), licence and Reserved Font Names;
- QA results, outline quality, and signs of AI-generated outlines (including what the submitter disclosed);
- the submitter's history on GitHub (foundry, first contribution…);
- a score, and a to-do list (decision, comment if information is missing, assignee, milestone, priority). Ticked cards fade out; ticks are kept in your browser.

Outline quality and AI signals are heuristics to help a reviewer, not verdicts.

### Typo Guide Generator

**[Open the generator](https://emmamarichal.github.io/gf-issues-dashboard/typo-guide/)** · code and full documentation in [`site/typo-guide/`](site/typo-guide/)

For giving a designer feedback on a submission without writing the same explanations again and again:

1. Tick the problems found on the font (accents, ß, outlines, spacing…). The tool suggests the matching resources and tutorials from an editable database.
2. Drop the font files: Fontspector runs in the browser with the Google Fonts profile. Tick the checks to mention and comment them.
3. Add screenshots, with a comment on each, and link them to a problem.
4. Copy the result: **a short Markdown checklist to post as a comment on the GitHub issue** (one line per problem, the commented FAILs), and **a link to the full report** with every resource, tutorial, screenshot and the complete Fontspector results.

The full report is stored in the link itself, in the [urlHosted](https://github.com/graphicore/urlHosted) format: nothing is uploaded or stored anywhere, and a link can't be changed afterwards (an edit gives a new link). GitHub limits a comment to 65,536 characters, link included, so screenshots are compressed to fit, and the tool says which ones to attach by hand if they don't.

Anyone can suggest a link or a tutorial from the [contribute page](https://emmamarichal.github.io/gf-issues-dashboard/typo-guide/contribute.html): it prepares a pull request on this repository, so nothing changes until it is merged.

## Proofs

### Reference proofs

**[Open Reference proofs](https://emmamarichal.github.io/gf-issues-dashboard/reference-proofs/)** · code in [`site/reference-proofs/`](site/reference-proofs/)

Drop any font (TTF, OTF or WOFF) and see it next to existing Google Fonts families of the same script, as in the DrawBot proof made for KarnataGTN:

- **Glyph by glyph:** one row per character, one column per font, with the font under review highlighted. Characters a reference does not have are marked, and each column shows its coverage.
- **Text:** pages of sample text where the font sits next to three references at a time.
- **Its named instances:** for a variable font, the same grid across its named instances instead of other families.

The script is detected from the font, and a set of reference families is suggested for it (27 scripts, from Kannada, Devanagari or Arabic to Cherokee, with five categories for Latin: sans, serif, mono, display, handwriting). You can remove families, add any Google Fonts family by name, or add font files of your own. Print the result or save it as a PDF (landscape A4).

The font you drop never leaves your browser. Reference fonts are downloaded from google/fonts on GitHub. To change the suggested families, edit [`reference_sets.json`](site/reference-proofs/data/reference_sets.json).

This is a working prototype of the second tool in the [gftools proofing plan](tool-plans/gftools-proofing/).

## Communication

### Font Social Post Generator

**[Open the generator](https://emmamarichal.github.io/gf-issues-dashboard/social-posts/)** · code and details in [`site/social-posts/`](site/social-posts/)

For announcing a family that just joined the catalogue. Paste a fonts.google.com link, the designer's repository or a family name; the tool reads `METADATA.pb` and the article in google/fonts, and:

- drafts a short caption in the tone of Google Fonts' posts (about 50 words) with the specimen link. **The designer is always named**: if the draft leaves them out, "Designed by …" is added;
- gathers the images from the article folder and the designer's repository, and flags the ones that are not in an Instagram ratio (1:1, 4:5, 1.91:1);
- lets you copy the text or download it with the images as a zip.

Writing the caption uses your own Anthropic API key, kept in your browser and sent only to api.anthropic.com. Without a key, the tool shows the article's opening paragraph instead (still with the designer credited).

## Plans

[`tool-plans/`](tool-plans/) holds one README per plan:

- **[Agent-assisted hotfixes](tool-plans/agent-hotfix/):** agents find issues that a script can fix, prepare the fix with fontspector and diffenator reports, and wait for a person's approval before any pull request. The dashboard is its first phase.
- **[Proofing tools for `gftools qa`](tool-plans/gftools-proofing/):** two proofs in diffenator3 and gftools: every glyph across the masters, and a comparison with reference families. Reference proofs is the browser prototype.

## How the site is built

A GitHub Actions workflow ([`.github/workflows/build.yml`](.github/workflows/build.yml)) runs every hour, on each push to `main`, and from **Actions → Build dashboard → Run workflow**. It reads the issues and a lightweight clone of google/fonts, analyses them, and publishes [`site/`](site/) to GitHub Pages. No secret is needed: the workflow's own `GITHUB_TOKEN` reads the public data. QA results are cached, and each build stops starting new QA after a time budget, so the first full QA run is spread over a few hourly builds (meanwhile some families show *Not checked*).

**Correcting the classification.** Add a line to [`pipeline/overrides.txt`](pipeline/overrides.txt) and commit:

```
11120 OUTL          # problem type: OUTL NAME VF VMET OTF DIAC MISSACC REND GLY MISS SPC SHAP INTP DES APP COLL OTH
2077 K:api          # kind: K:upgrade K:api K:request K:tools K:new
8288 F:ofl/inter    # family the issue is about
```

**Running it locally.**

```bash
pip install -r requirements.txt
python pipeline/build.py          # needs gh logged in; options: --skip-qa --skip-submissions --no-submitter
python -m http.server -d site 8000
```

QA uses fontspector when installed, otherwise fontbakery (googlefonts profile, network checks ignored).

```
pipeline/            build of the dashboard and the submissions report (Python)
site/                what GitHub Pages serves
  index.html         GF Issue Dashboard
  reference-proofs/  Reference proofs (static, runs in the browser)
  social-posts/      Font Social Post Generator (static, runs in the browser)
  typo-guide/        Typo Guide Generator (static, runs in the browser)
tool-plans/          one README per plan
```
