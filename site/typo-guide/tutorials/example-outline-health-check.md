# A five-minute outline health check

Most outline problems flagged by automated QA tools are quick to fix once
you know where to look. Run through this before sending a font out for
review — it catches the majority of what a tool like Fontspector would
otherwise flag.

## 1. Open paths

Every contour should be closed. An open path usually renders fine in the
editor but can cause rendering glitches or hinting failures downstream.
Most editors have a dedicated command for this (Glyphs: **View → Show
Corners** combined with **Filter → Correct Path Direction** will surface
most of them; FontForge: **Element → Point of View → Open Contours**).

## 2. Overlaps

If you draw with overlapping shapes (a common technique for round
strokes joining straight ones) and don't remove overlaps before export,
the exported outline can self-intersect. Always run a "remove overlap"
pass as a final step, on a copy — never as your working file, since it's
a one-way operation.

## 3. Missing extrema

An extremum is the point of a curve that's at its absolute top, bottom,
left, or right. Missing one doesn't look wrong at a glance, but it means
the outline's bounding box is technically incorrect, which throws off
autohinting and can create a subtly wrong rasterization at small sizes.
Add extrema *after* your final shape is settled, not before — adding them
early and then continuing to edit tends to leave stray points behind.

## 4. Contour direction

Outer contours should run clockwise, inner (counter) contours
counterclockwise — or consistently the opposite, as long as it's the same
convention throughout the whole font. Mixed directions are invisible in
the editor but can cause counters to fill in solid, or fonts to render
correctly in one application and incorrectly in another.

## 5. Point count sanity check

Not a hard rule, but worth a glance: if one glyph in a family has three
times as many points as its siblings for a similarly-shaped letter, it's
worth a look. It's often leftover points from an earlier edit that never
got cleaned up.

---

*This is a starting-point example tutorial bundled with the tool —
replace or expand it with your own team's actual checklist.*
