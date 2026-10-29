# Set up the config.yaml

Most variable-font build pipelines (the Google Fonts toolchain among
them) don't compile straight from your source files — they read a
`config.yaml` first, which tells the builder *how* to turn your sources
into the final font files. Most build failures that look like font
problems are actually config problems.

## What it's for

`config.yaml` sits next to your source files and answers questions the
builder can't guess on its own: which sources make up the family, what
the family should be called once compiled, which category it belongs to,
and what order its variable axes should be listed in.

## A minimal example

```yaml
sources:
  - sources/MyFont.designspace
familyName: "My Font"
category: ["SANS_SERIF"]
axisOrder: ["wght", "wdth"]
```

## The fields that matter most

- **`sources`** — the designspace or UFO files the build starts from.
  Get this list wrong (a missing master, a typo'd path) and the build
  either fails outright or silently compiles from the wrong sources.
- **`familyName`** — the name that ends up in the font's metadata. This
  is a common source of "why does my font have the wrong name" issues —
  it overrides whatever the sources themselves say.
- **`category`** — used by some pipelines to decide default settings and
  where the font gets categorized once published.
- **`axisOrder`** — the sequence variable axes are listed in, which
  affects the STAT table and, downstream, how applications present the
  font's controls to a user. Get this out of sync with what's actually
  in the sources and you'll see STAT-related QA fails that have nothing
  to do with your actual outlines.

## Common validation errors

- A `sources` path that doesn't match the actual file location (case
  sensitivity trips people up especially often, since it's invisible
  locally on some operating systems but not on the build server).
- `axisOrder` listing an axis that isn't defined in any source file, or
  missing one that is.
- `familyName` left as a placeholder value copied from an example config
  and never updated.

---

*This is a starting-point example tutorial bundled with the tool —
replace or expand it with the actual config conventions your pipeline
uses.*
