# Google Fonts tools

Tools for the people who triage, review and onboard fonts for [Google Fonts](https://github.com/google/fonts), made by Emma Marichal. Each one is a web page on GitHub Pages, so there is nothing to install. All of them live in this repository, except the Typo Guide Generator, which has its own: [fontsglowup](https://github.com/emmamarichal/fontsglowup).

None of the tools acts on GitHub by itself: nothing is commented, labelled or opened as a pull request unless a person does it.

| Tool | Use it to | Open | Code |
| --- | --- | --- | --- |
| Issue dashboard | See what is in the google/fonts issue backlog, what a script could fix, and what could be closed. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/) | [`pipeline/`](pipeline/), [`site/index.html`](site/index.html) |
| Submissions to review | Go through every pending font submission on one page, with a score and a to-do list per font. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/submissions.html) | [`pipeline/gf_submissions.py`](pipeline/gf_submissions.py) |
| Typo Guide Generator | Give a designer feedback: a short checklist to post on the GitHub issue, with a link to the full report. | [Open](https://emmamarichal.github.io/fontsglowup/) | [fontsglowup](https://github.com/emmamarichal/fontsglowup) |
| Reference proofs | Compare a font with Google Fonts families of the same script, glyph by glyph and in text. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/reference-proofs/) | [`site/reference-proofs/`](site/reference-proofs/) |
| Font Social Post Generator | Draft the post announcing a new family, with its images and the designer credited. | [Open](https://emmamarichal.github.io/gf-issues-dashboard/social-posts/) | [`site/social-posts/`](site/social-posts/) |

Plans for tools that are not built yet are in [`tool-plans/`](#plans).

---

## Issue dashboard

**[Open](https://emmamarichal.github.io/gf-issues-dashboard/)** · Code: [`pipeline/`](pipeline/), [`site/index.html`](site/index.html)

The open google/fonts issues, analysed every hour:

- **The backlog:** issues by kind (font bug, submission, upgrade, API, request…), font bugs by problem type, with their age and activity.
- **What can be fixed quickly:** each font bug gets a feasibility rating (can a script fix it, without design work?) and a priority. The shipped binaries of the fixable ones are checked with the googlefonts profile, because a family that already fails other checks cannot take a simple hotfix.
- **What could be closed:** issues about a font updated since the issue was opened, issues a commit says it fixes, old issues with no interest. Nothing is closed automatically; each one comes with the evidence to check.

When the page opens, it also asks GitHub which issues were closed or opened since the last analysis. To correct a classification, see [Maintaining the site](#maintaining-the-site).

## Submissions to review

**[Open](https://emmamarichal.github.io/gf-issues-dashboard/submissions.html)** (also from the *Generate submission to review report* button of the issue dashboard) · Code: [`pipeline/gf_submissions.py`](pipeline/gf_submissions.py)

One card per issue labelled *II Submission* in the *Submissions to review* milestone, updated every hour:

- specimen, links to the issue and the source repository;
- glyphsets and languages covered, source format (.glyphs, UFO…), licence and Reserved Font Names;
- QA results, outline quality, signs of AI-generated outlines and what the submitter disclosed;
- the submitter's history on GitHub (foundry, first contribution…);
- a score and a to-do list (decision, comment if information is missing, assignee, milestone, priority). Ticked cards fade out; the ticks are kept in your browser.

Outline quality and AI signals are heuristics to help a reviewer, not verdicts.

## Typo Guide Generator

**[Open](https://emmamarichal.github.io/fontsglowup/)** · Code and full documentation: [emmamarichal/fontsglowup](https://github.com/emmamarichal/fontsglowup)

Feedback on a submission, without writing the same explanations again and again:

1. Tick the problems found on the font (accents, ß, outlines, spacing…). The tool suggests matching resources and tutorials from an editable database.
2. Drop the font files: Fontspector runs in the browser with the Google Fonts profile. Tick the checks to mention and add a comment.
3. Add screenshots, with a comment on each, and link them to a problem.
4. Copy **a short Markdown checklist to post on the GitHub issue** (one line per problem, plus the commented FAILs) with **a link to the full report**: every resource, tutorial and screenshot, and the complete Fontspector results.

The full report is stored in the link itself ([urlHosted](https://github.com/graphicore/urlHosted) format): nothing is uploaded, and a link cannot be changed afterwards. GitHub limits a comment to 65,536 characters, link included, so screenshots are compressed to fit; the tool says which ones to attach by hand when they don't.

Anyone can suggest a link or a tutorial from the [contribute page](https://emmamarichal.github.io/fontsglowup/contribute.html). It prepares a pull request on the fontsglowup repository, so nothing changes until it is merged.

## Reference proofs

**[Open](https://emmamarichal.github.io/gf-issues-dashboard/reference-proofs/)** · Code: [`site/reference-proofs/`](site/reference-proofs/)

Drop any font (TTF, OTF or WOFF) and see it next to Google Fonts families of the same script, like the DrawBot proof made for KarnataGTN:

- **Glyph by glyph:** one row per character, one column per font, the font under review highlighted. Characters a reference lacks are marked, and each column shows its coverage.
- **Text:** pages of sample text, with the font next to three references at a time.
- **Named instances:** for a variable font, the same grid across its own instances instead of other families.

The script is detected from the font and reference families are suggested for it: 27 scripts, and five categories for Latin (sans, serif, mono, display, handwriting). You can remove families, add any Google Fonts family by name, or add your own font files. Print the result or save it as a PDF (landscape A4).

The font you drop never leaves your browser; reference fonts are downloaded from google/fonts. The suggested families are in [`reference_sets.json`](site/reference-proofs/data/reference_sets.json). This is a working prototype of the [gftools proofing plan](tool-plans/gftools-proofing/).

## Font Social Post Generator

**[Open](https://emmamarichal.github.io/gf-issues-dashboard/social-posts/)** · Code and details: [`site/social-posts/`](site/social-posts/)

For a family that just joined the catalogue. Paste a fonts.google.com link, the designer's repository or a family name. The tool reads `METADATA.pb` and the article in google/fonts, then:

- drafts a caption in the tone of Google Fonts' posts (about 50 words) with the specimen link. **The designer is always named**: if the draft leaves them out, "Designed by …" is added;
- gathers images from the article folder and the designer's repository, and flags those that are not in an Instagram ratio (1:1, 4:5, 1.91:1);
- lets you copy the text, or download it with the images as a zip.

The caption is written with your own Anthropic API key, kept in your browser and sent only to api.anthropic.com. Without a key, the tool shows the article's opening paragraph instead, still with the designer credited.

---

## Plans

[`tool-plans/`](tool-plans/) has one README per plan:

- **[Agent-assisted hotfixes](tool-plans/agent-hotfix/):** agents find issues that a script can fix, prepare the fix with fontspector and diffenator reports, and wait for a person's approval before any pull request. The issue dashboard is its first phase.
- **[Proofing tools for `gftools qa`](tool-plans/gftools-proofing/):** two proofs in diffenator3 and gftools, every glyph across the masters and a comparison with reference families. Reference proofs is its browser prototype.

## Maintaining the site

**Publishing.** A GitHub Actions workflow ([`.github/workflows/build.yml`](.github/workflows/build.yml)) runs every hour, on each push to `main`, and from **Actions → Build dashboard → Run workflow**. It analyses the issues and submissions, then publishes [`site/`](site/) to GitHub Pages. No secret is needed: the workflow's own `GITHUB_TOKEN` reads the public data. QA results are cached, and each build stops starting new QA after a time budget, so a large QA run is spread over several hourly builds (meanwhile some families show *Not checked*).

**Correcting a classification** in the issue dashboard: add a line to [`pipeline/overrides.txt`](pipeline/overrides.txt) and commit.

```
11120 OUTL          # problem type: OUTL NAME VF VMET OTF DIAC MISSACC REND GLY MISS SPC SHAP INTP DES APP COLL OTH
2077 K:api          # kind: K:upgrade K:api K:request K:tools K:new
8288 F:ofl/inter    # family the issue is about
```

**Running the analysis locally:**

```bash
pip install -r requirements.txt
python pipeline/build.py          # needs gh logged in; options: --skip-qa --skip-submissions --no-submitter
python -m http.server -d site 8000
```

QA uses fontspector when installed, otherwise fontbakery (googlefonts profile, network checks ignored). The other tools are static pages: serve `site/` the same way to try them.

**Layout:**

```
pipeline/            analysis behind the issue dashboard and the submissions report (Python)
site/                what GitHub Pages serves
  index.html         Issue dashboard
  reference-proofs/  Reference proofs
  social-posts/      Font Social Post Generator
tool-plans/          one README per plan
```