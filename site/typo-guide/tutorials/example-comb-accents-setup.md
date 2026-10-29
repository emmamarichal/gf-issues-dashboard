# How to set up comb accents

Combining marks — the accents that sit on top of a base letter rather
than being pre-composed into their own glyph — rely on a small, specific
mechanism to position themselves correctly: anchors. Get the anchors
right and the positioning is automatic, in any combination.

## Two kinds of positioning

- **Mark-to-base**: an accent attaching to a regular letter (`a` + comb
  acute → `á`).
- **Mark-to-mark**: an accent attaching to *another* accent, for stacked
  diacritics (Vietnamese tone + vowel modifier is the classic case).

They're set up separately, and it's easy to build one and forget the
other — a font can position single accents perfectly and still fail on
every stacked combination.

## Anchors, and how they're named

On the **base** glyph, add an anchor named `top` (or `bottom`, for marks
that sit below, like a cedilla). On the **mark** glyph itself, add the
matching anchor with an underscore prefix: `_top` / `_bottom`. The
engine connects a base's `top` to a mark's `_top` automatically — the
underscore is what tells it "this is the attachment point," not the
name similarity alone.

For mark-to-mark (stacking one accent on another), the *mark* glyph
needs **both** an anchor to receive a lower mark (plain `top`) and the
attachment anchor for itself (`_top`) — it's playing both roles at once.

## Testing it actually works

- Type a base letter followed by a combining mark in a real text
  environment (not just the font editor's preview) — the editor's own
  preview sometimes fakes positioning that a real shaping engine won't
  reproduce.
- Use the dotted-circle glyph (`◌`, U+25CC) to preview a mark in
  isolation — if it's missing from the font, add it; several tools rely
  on it to show marks out of context.
- If available, run the font through an actual shaping engine (HarfBuzz)
  rather than trusting the editor alone — that's what will actually be
  used to render the font in the real world.

## Common pitfalls

- **Anchor names that don't match exactly** (`Top` vs `top`, a stray
  space) — the connection silently fails, and the mark falls back to
  its default position instead of erroring loudly.
- **A missing GDEF mark-glyph class** — some environments won't apply
  mark positioning at all if the marks aren't correctly classified.
- **An anchor placed for one weight but not adjusted across the whole
  family** — the accent looks fine on Regular and drifts on Bold, where
  the base letterform is wider.

---

*This is a starting-point example tutorial bundled with the tool —
replace or expand it with your own team's actual anchor conventions.*
