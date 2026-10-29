# Agent-assisted hotfixes for google/fonts issues

> **Status (October 2026).** Phase 0 is running: the [GF Issue Dashboard](https://emmamarichal.github.io/gf-issues-dashboard/) classifies every open issue, rates feasibility, checks the shipped binaries with fontbakery and lists issues that could be closed. Phases 1 to 3 (digest, fix recipes, review screen, PRs) are not built. Nothing is posted to google/fonts automatically, and every PR needs a person's approval.
>
> First shared with the team as a Word document; this is the same text.

*Proposal for team review. Draft, 15 October 2026.*

## Summary

A meaningful share of open google/fonts issues are technical defects in the shipped binaries that can be fixed with a short, deterministic script and no design work. We propose a pipeline in which agents find these issues, classify them, prepare a fix with full QA (fontspector and diffenator), and hand each one to a human for approval before any pull request is opened. Nothing reaches google/fonts without a person approving it.

We think this is feasible today. The tooling for each step already exists (gftools, fontspector, diffenator, the GitHub API); the new work is the triage logic, a library of vetted fix recipes, and a review screen that lets one person check a fix in a couple of minutes. We recommend starting with a read-only phase (issue digest, classification and a chart of the backlog) and adding automated fixes for two or three fix types once the classification has proven reliable.

## Why

The repository has about 1,400 open issues. Many are submissions or need design, language expertise or an upstream release. Some, however, are mechanical. Issue [\#11120](https://github.com/google/fonts/issues/11120) is a good example: in Baloo 2 v1.700, overlapping contours are missing the OVERLAP_SIMPLE flag, which makes stems bulge on macOS and Windows. The reporter already identified the cause and the fix (set the flag in the variable font, remove overlaps in static instances) with a few lines of fontTools. The upstream repository has not responded to the same report since 2022.

Issues like this wait in the queue because packaging, QA and the PR still take a person's time, not because the fix is hard. Automating everything around the fix, while keeping the decision human, should shorten that wait without adding risk.

## Scope

### In scope

- Bugs in binaries already in ofl/, apache/ or ufl/ that can be fixed by a script: outline flags and overlaps, naming and metadata tables, STAT and fvar data, vertical metrics, gasp and hinting flags, missing composite glyphs whose base and mark already exist, broken or missing mark positioning and simple OpenType feature fixes.
- Classifying all open issues, including those out of scope, so the team gets a picture of the backlog.
- Draft replies to new issues, for a human to edit and post.

### Out of scope

- Anything labelled or classified as needing design work, new glyph design or language expertise.
- New font submissions and onboarding.
- API, website and platform issues (these are routed, not fixed).
- Automatic posting of comments, labels or PRs without human approval.

## Pipeline overview

The pipeline has seven stages. Stages 1 to 3 are read-only and can run daily. Stages 4 to 6 run only for issues the triage marks as fixable and shippable. Stage 7 is the human gate.

1.  Collect new and updated issues from google/fonts.
2.  Classify each issue by problem type.
3.  Assess fixability and shippability, using a fontspector run on the currently shipped binaries.
4.  Apply a fix recipe and bump the version.
5.  Run QA: fontspector before and after, diffenator before and after.
6.  Prepare the PR branch, PR description and draft issue reply.
7.  Human review in a single screen, then the PR is opened.

Reporting (the backlog chart and digest) reads from the same data store as stages 1 to 3.

## Stage details

### Collect

Poll the GitHub API for issues created or updated since the last run. Store each issue with its labels, milestone, assignee, linked upstream issues, family name and the ofl/ path it refers to, in a small local database (SQLite is enough). Issues carrying "I New Font", "II Submission", "-- Needs design work" or "I API / Website / Platform" are kept for reporting but skipped by the fix stages.

### Classify

An agent reads the issue text, any screenshots and linked upstream issues, and assigns one primary category from a fixed taxonomy, plus a confidence score. The taxonomy below is a starting point for discussion; it maps to existing repository labels where one exists.

| Category                      | Typical example                                                | Fix approach                   | Automatable                       |
|-------------------------------|----------------------------------------------------------------|--------------------------------|-----------------------------------|
| Outline flags and overlaps    | Missing OVERLAP_SIMPLE, overlaps in statics                    | fontTools script               | High                              |
| Naming and metadata           | Wrong name IDs, fsSelection, usWeightClass, METADATA.pb errors | Table edit                     | High                              |
| Variable font tables          | Wrong STAT, fvar defaults, named instances                     | gftools gen-stat or table edit | High                              |
| Missing composites            | Accented letter missing, base and mark present with anchors    | Build composite and mark data  | Medium                            |
| Vertical metrics and clipping | Clipped diacritics, inconsistent line height                   | Recompute metrics to GF rules  | Medium (layout changes for users) |
| Rendering and hinting         | gasp table, unhinted flags                                     | gftools fix scripts            | Medium                            |
| OpenType features             | Missing ccmp or locl, broken substitution                      | Feature edit                   | Medium to low                     |
| Spacing and kerning           | Loose pair, sidebearing error                                  | Usually design judgement       | Low, flag only                    |
| Interpolation in outlines     | Kinks or wobble between masters                                | Source or design fix           | Low, flag only                    |
| Glyph coverage needing design | Missing Ө ө Ү ү for Mongolian Cyrillic                         | Design work                    | Out of scope                      |
| Language and sample text      | Wrong .nam or sample text                                      | Not a binary fix               | Route                             |
| API and platform              | CSS API, website behaviour                                     | Eng team                       | Route                             |

Before trusting the classifier, we label about 100 existing issues by hand and measure agreement. Issues below a confidence threshold go to a "needs human triage" bucket rather than being guessed.

### Assess fixability and shippability

These are two separate questions, and the second one decides whether the work is worth doing.

- **Fixable:** can the fix be expressed as one of our vetted recipes, applied to the binary, touching only the glyphs or tables named in the issue?
- **Shippable:** run fontspector with the googlefonts profile on the binaries currently in ofl/. If the family already fails checks that a binary update would be required to pass (for example an older family that predates current specs for STAT, vertical metrics or naming), a hotfix alone either fails CI or turns into a much larger update. The fix may be easy and still not be shippable.

Each issue gets one of three statuses:

- **Green:** fixable, and the family has no blocking pre-existing FAILs. The pipeline prepares a fix.
- **Amber:** fixable, but the family has pre-existing FAILs. The pipeline prepares the fix plus a list of what else would need to change, and an onboarder decides whether a hotfix is acceptable or the family needs a full update.
- **Red:** needs design, source changes or upstream work. The pipeline only drafts a reply and, where useful, an upstream issue.

The assessment also checks two things that change the approach. First, whether the upstream repository is active: if it is, the better path is an upstream PR followed by gftools packager, so the next upstream release does not undo the fix. Second, the family's OFL.txt for Reserved Font Names, which restrict distributing modified versions under the original name unless permission exists.

### Apply the fix and bump the version

Fixes come from a library of recipes: small, reviewed Python scripts built on fontTools and gftools, each with tests and a declared list of what it may change. The agent's job is to diagnose the issue and choose a recipe with parameters, not to write ad-hoc edits to font binaries. If no recipe fits, the agent can propose a new one, which is marked as a draft and needs an extra review before it is added to the library.

Every fixed binary gets a version bump: head.fontRevision and name ID 5 move together (for example 1.700 to 1.701), and fontspector's version_bump check confirms the new version is higher than the one served. The recipe name and parameters are recorded in the PR so the change can be reproduced.

### Run QA

- fontspector, googlefonts profile, on the binaries before and after the fix. The report highlights new FAILs, resolved FAILs and unchanged FAILs separately.
- diffenator (via gftools qa) between the before and after binaries, with images.
- An automatic check that only the expected glyphs and tables changed. A change outside the declared scope blocks the fix and flags it for a person.

Rule: a fix that introduces any new fontspector FAIL is not proposed.

### Prepare the PR

One family per branch. The branch replaces the binaries in ofl/\<family\>/ (and METADATA.pb only if needed). The PR description is generated from a template: link to the issue ("Fixes \#11120"), what changed and why, the recipe used, the fontspector delta and a diffenator summary. The pipeline also drafts a reply for the issue and, when there is a source repository, an issue or PR for upstream.

The number of open hotfix PRs is capped, because each push to a google/fonts PR triggers CI and many simultaneous runs can break it.

### Human review

All prepared fixes appear in one review screen before any PR exists. For each fix it shows the issue summary and category, before and after renderings of the affected glyphs, the fontspector delta, the diffenator report, a table-level diff, the recipe and its parameters, and the draft PR text and issue reply. The reviewer can approve (the PR is opened), edit the text, send it back with a note, or reject. After that, the PR goes through normal google/fonts review and CI like any other.

## Issue digest and reply suggestions

Separate from fixes, the same data feeds a daily or weekly digest for whoever is on triage. For each new or updated issue it shows a two-line summary, the proposed category and labels, possible duplicates, the fixability status and a suggested reply. Typical suggested replies: ask for missing information (font version, OS, browser, screenshot), point to a duplicate, explain that a request needs design work and is queued, or say that a fix is being prepared. Replies are never posted automatically.

The digest could live in a small private web page or arrive as a scheduled report; this is a team preference.

## Backlog reporting

A chart of open issues by category, updated weekly, with:

- Counts per category and per Green, Amber or Red status.
- Age distribution per category.
- Trend over time: opened versus closed per category.
- Size of the hotfix-eligible backlog, which is the main number this project should reduce.

This complements the existing weekly activity report at google.github.io/fonts rather than replacing it.

## Where agents are used, and where they are not

| Task                                                                                                      | Done by                                         |
|-----------------------------------------------------------------------------------------------------------|-------------------------------------------------|
| Fetching issues, running fontspector and diffenator, version bump, diff checks, creating branches and PRs | Deterministic code                              |
| Reading issue text and screenshots, classifying, finding duplicates and upstream links                    | Agent                                           |
| Choosing a fix recipe and its parameters from the diagnosis                                               | Agent, checked by the scope diff                |
| Interpreting fontspector results for shippability                                                         | Agent, with a fixed rule set for blocking FAILs |
| Writing PR descriptions, issue replies and upstream reports                                               | Agent, edited by a human                        |
| Approving a fix and opening the PR                                                                        | Human                                           |

## Implementation options

- **Local or self-hosted tool:** a CLI plus a small review web page, with agents run through the Claude Agent SDK or Claude Code on a schedule. Easiest to iterate on, and tokens with write access to google/fonts stay with the reviewer.
- **GitHub Agentic Workflows in a separate repository:** scheduled runs that read google/fonts and write their results (fixed binaries, reports) to a staging repository. google/fonts already runs an "Issue Triage Assistant" agentic workflow (its runs are tracked in issue \#11080, currently reporting agent failures), so we should coordinate with whoever owns it rather than run a second triage bot on the same issues.

In both cases, issue text is untrusted input. The agent that reads issues should not hold a token that can push to google/fonts or post comments; it produces proposals, and a separate step with write access acts only on approved proposals.

## Risks and mitigations

- **Binary diverges from upstream sources.** Prefer upstream fixes when upstream is active; always file the fix upstream; keep a record of hotfixes per family so a future upstream update can be checked against it.
- **Visible regressions for users.** Scope diff, before and after renderings, no new FAILs, and a human approval on every change. Vertical metrics fixes get extra caution because they change line spacing in existing documents.
- **Misclassification.** Measured against hand-labelled issues before use; low-confidence issues go to a human.
- **Prompt injection through issue text.** Privilege separation as described above.
- **Reviewer load.** Cap on open hotfix PRs; batch review sessions; the review screen is designed for a decision in a few minutes.
- **Licensing.** Check for Reserved Font Names before modifying any OFL family.

## Worked example: Baloo 2 (#11120)

- **Category:** outline flags and overlaps. Confidence high: the issue names the table, flag and glyphs.
- **Fixability:** Green candidate. Recipe "set OVERLAP_SIMPLE on simple glyphs with overlapping contours" applied to ofl/baloo2/Baloo2\[wght\].ttf.
- **Shippability:** run fontspector on the current v1.700 binary; Green if no blocking FAILs, Amber otherwise.
- **Upstream:** EkType/Baloo2 has not answered the same report since 2022, so a binary hotfix is justified, with a comment upstream linking the fix.
- **Version:** 1.700 to 1.701.
- **QA:** diffenator should show no outline changes; the scope diff should show only glyf flag changes. A rendering check on macOS and Windows confirms the bulge is gone.
- **Open point:** the issue also mentions static instances. If the API generates them from the variable font, we need to confirm with Eng whether overlaps are removed at that stage.

## Roadmap

Durations are estimates for one person part-time and will be revised after phase 0.

1.  **Phase 0, about 1 week:** pull all open issues, agree on the taxonomy, classify the backlog, hand-label about 100 issues to measure accuracy, publish the first backlog chart. Output: how many issues are hotfix candidates.
2.  **Phase 1, about 2 weeks:** daily or weekly digest with suggested labels and replies. Read-only.
3.  **Phase 2, about 3 to 4 weeks:** fix pipeline for two or three recipes (outline flags, naming and metadata, STAT), QA reports and the review screen. PRs opened by hand from approved fixes.
4.  **Phase 3:** PR creation from the review screen, upstream follow-up, more recipes based on what phase 0 shows is most common.

## How we measure success

- Time from issue opened to PR for hotfix-eligible issues.
- Share of proposed fixes approved without changes.
- Zero new fontspector FAILs and zero reverted hotfixes.
- Reviewer time per approved fix.
- Size of the hotfix-eligible backlog over time.

## Questions for the team

- What is our policy on binary-only hotfixes versus upstream-first, and when is an Amber family acceptable to hotfix?
- Who reviews fixes, and how many hotfix PRs per week can the team absorb?
- Who owns the existing Issue Triage Assistant workflow, and should this project extend it?
- Where should the tool run, and which token is used to open PRs?
- Are some families excluded (for example families with an active commissioned upstream)?
- Should suggested labels be applied automatically once accuracy is proven, or always by hand?
