# Proofing tools for `gftools qa`: implementation roadmap

> **Status (October 2026).** Nothing is in gftools or diffenator3 yet. A browser prototype of both tools is live as [Reference proofs](https://emmamarichal.github.io/gf-issues-dashboard/reference-proofs/) ([code](../../site/reference-proofs/)):
> - **Tool B** is the *Reference families* mode: drop a font, get a glyph-by-glyph grid against suggested Google Fonts families of the same script, and text pages with the font next to three references at a time.
> - **Tool A** is approximated by the *Its named instances* mode: columns are the font's fvar named instances, not the masters derived from `gvar` that `DFont::masters()` gives.
>
> The prototype's curated lists ([`reference_sets.json`](../../site/reference-proofs/data/reference_sets.json)) are a first draft of the `reference_sets.yaml` described below. Every family in them was checked to cover its script.
>
> The plan was written in June 2026, after the DrawBot comparison of KarnataGTN with other Kannada fonts.

## Locked decisions

1. **Integration point**: new options on `gftools qa` (not a separate `gftools proofer` subcommand).
2. **Rendering backend**: HTML, browser-shaped, native in the **Rust** engine (`diffenator3` / `diff3proof` family). Same engine the team already uses via `gftools qa --rust`.
3. **Reference selection (tool B)**: hand-maintained **curated lists keyed by category** (sans-serif, serif, devanagari, kannada, …), shipped in gftools.
4. **Code ownership**: the rendering logic lives in **diffenator3 (Rust)**; gftools only orchestrates (resolves categories, fetches reference families, calls the binaries).

## The two tools

- **Tool A: glyphset × all masters.** One font in, one HTML out: the full glyphset rendered once per master location of the variable font.
- **Tool B: compare to a reference panel.** A candidate font laid out against N curated reference families (chosen by category), glyph by glyph and in sample-text blocks, candidate highlighted. This is the HTML port of the DrawBot Kannada document.

## What already exists in diffenator3-lib (reuse, don't rebuild)

- `DFont::masters() -> Vec<Vec<VariationSetting>>`: heuristic master locations from `gvar` shared tuples. **Exactly tool A's input.**
- `DFont::supported_scripts() -> HashSet<String>`: for validating or auto-detecting the script in tool B.
- `DFont::axis_info()`, `instances()`, `set_location()`, `set_instance()`, `family_name()`, `style_name()`.
- `shared_axes(a, b)`: the two-font axis intersection (used by diff3proof today).
- `html::gen_html(font1, font2, out, tera, template, vars, outfile, pt_size)`: copies the two fonts beside the HTML and renders a Tera template. **Hardcoded to two fonts.**
- `html::template_engine(user_templates, overwrite)` + `create_user_home_templates_directory`: Tera setup; stock templates are `include_str!`-baked and overridable via `--templates`.

Embedding mechanism to mirror in new templates: font files are copied next to the HTML; the template declares them in `@font-face { src: url(...) }`; the browser does the shaping; `font-variation-settings` selects the instance or master.

## Rust changes (diffenator3)

### R1. Multi-font rendering helper (needed by tool B)

Add to `diffenator3-lib/src/html.rs`:

```rust
pub fn gen_html_multi(
    fonts: &[(PathBuf, String)],   // (path, label)
    output_dir: &Path,
    tera: Tera,
    template_name: &str,
    template_variables: &Value,
    output_file: &str,
    point_size: u32,
) -> !
```

Copies each font to `font-{i}-{name}` and exposes a `fonts` array (`{filename, label}`) to the template. Leave `gen_html` untouched for back-compat (tool A and the existing diff3proof keep using it).

### R2. New templates (baked in)

Add `templates/proofmasters.html` and `templates/proofpanel.html`; register both in the `all_templates` array of `create_user_home_templates_directory` so they ship inside the binary. Reuse `style.css` / `shared.js`.

- `proofmasters.html`: receives the glyphset (codepoints) and the list of master locations as `font-variation-settings` strings; renders one labelled block per master, each showing the whole glyphset.
- `proofpanel.html`: receives the `fonts` array (candidate flagged) and a shared set of codepoints and/or sample-text blocks; renders a glyph-per-row grid with the candidate column highlighted, plus text blocks where the candidate is surrounded by references.

### R3. New binaries (mirror the diff3proof crate/bin split)

- `diff3masters` (tool A): read one font → `font.masters()` → build variation-settings strings → glyphset from `cmap` → `gen_html` (font as both args) + `proofmasters.html`.
- `diff3panel` (tool B): read candidate + N reference paths (+ optional labels) → `gen_html_multi` + `proofpanel.html`. Sample text via the existing `google-fonts-languages` path already used by diff3proof (filtered by shared codepoints). The candidate is `fonts[0]`, flagged.

Where the bins live (one crate, or flags on diff3proof) is a low-stakes choice to settle at PR time; sibling bins match the repo idiom (`diff3proof`, `diffenator3`, `kerndiffer`).

## gftools changes (Python glue)

### G1. CLI flags: `Lib/gftools/scripts/qa.py`

Add to `check_group`, alongside `--proof` / `--diffenator` / `--interpolations`:

- `--proof-masters`
- `--proof-references` (+ `--reference-category CATEGORY`, optional `--reference-family ...` overrides)

Wire them in `main()` to the new `FontQA` methods, honouring `args.rust` (these are Rust-only proofs).

### G2. `FontQA` methods: `Lib/gftools/qa.py`

Mirror the existing `proof()` / `diffbrowsers()` shell-outs to `diff3proof`:

- `proof_masters()` → shell out to `diff3masters`.
- `proof_references(category)` → resolve the curated list → locate or fetch each reference family (reuse `download_family_from_Google_Fonts`) → shell out to `diff3panel` with the resolved paths.

### G3. Curated reference data

Ship `Lib/gftools/proofing/reference_sets.yaml`, keyed by category → list of GF family names, hand-maintained:

```yaml
devanagari:
  - Noto Sans Devanagari
  - Hind
  - Mukta
  - ...
sans-serif:
  - ...
```

Category validation can cross-check against the candidate's `supported_scripts()` (warn on mismatch) without forcing auto-selection.

## No duplication with existing QA

- `gftools qa` (diffenator, diffbrowsers, diff3proof) always compares a family to **its own previous version**. Neither new tool does that.
- Tool A's glyphset sweep is distinct from diff3proof's language-sample proof: exhaustive glyph × master versus shaped sample text.
- Tool B (candidate versus other catalogue families) has no equivalent anywhere in the stack.

## Sequencing

- **Phase 1: tool A end to end.** The smallest loop that proves the whole chain (new Rust bin → new `gftools qa` flag → HTML). Reuses `masters()` and the existing `gen_html`. Deliverables: `proofmasters.html`, `diff3masters`, `--proof-masters`, `proof_masters()`.
- **Phase 2: tool B rendering.** `gen_html_multi` + `proofpanel.html` + `diff3panel`; validate against a hand-picked reference set first (the Kannada case as the smoke test).
- **Phase 3: catalogue wiring.** Curated `reference_sets.yaml` + `proof_references()` resolution and fetch + `--proof-references` flag.

## Open points

- Whether tool B's default view is glyph by glyph, text blocks, or both behind a flag. The browser prototype shows both.
- Exact bin packaging in diffenator3 (sibling bins or flags on diff3proof).
