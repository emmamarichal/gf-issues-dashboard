# Organizing composite glyphs for consistent diacritics in Glyphs

If accents look right on a handful of letters but drift on others, the
usual cause isn't the accent shapes themselves — it's how the base and
mark glyphs are connected. This is a short workflow for keeping that
connection consistent across a whole family.

## Build accents as components, not fresh outlines

Draw each accent once (`grave`, `acute`, `circumflex`, `tilde`, `dieresis`,
`caron`...) as its own standalone glyph, positioned as it would sit over a
capital letter. Every composite (`agrave`, `eacute`, `ocircumflex`...)
should then be built as a **base component + accent component**, never as
freshly drawn outlines. If you ever redraw the base letterform, every
composite updates automatically — that alone eliminates most of the
"looks fine on some letters" problem.

## Anchors, and naming them consistently

Two anchors do the actual positioning:

- `top` on the base glyph, `_top` on the accent — for uppercase and most
  lowercase letters.
- A second pair (commonly `top_de` / `_top_de` in Glyphs' German locale
  convention, or just a taller `topheight` variant) if a language's
  convention needs the mark noticeably higher — German capital umlauts
  are the classic case.

Keep the naming **identical across every glyph in the family**. A single
mismatched anchor name is the most common reason a font passes visual
inspection at a few test sizes but fails a full QA pass.

## A five-minute consistency check

1. Generate a test PDF (or use Glyphs' own PDF export) showing every
   accented glyph at a fixed point size, side by side.
2. Look specifically at accent *height above the base letter* — not the
   accent's absolute height, since cap-height and x-height differ.
3. Flag anything where the accent sits visibly higher or lower than its
   neighbors. That's almost always a missing or misnamed anchor, not a
   drawing problem.

> This is a starting-point example tutorial bundled with the tool —
> replace or expand it with your own team's actual workflow.
