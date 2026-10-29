# Font Social Post Generator

**[Open the tool](https://emmamarichal.github.io/gf-issues-dashboard/social-posts/)**

A tiny static site: paste **the designer's GitHub repo** (e.g. `github.com/maxesnee/savate`),
a Google Fonts URL, or just a family name, click **Generate social media post**, and it will:

1. Look up the family in [google/fonts](https://github.com/google/fonts) (tries `ofl/`, `apache/`, `ufl/`)
2. Read `METADATA.pb` (designer, category, license, the font's own source repo)
3. Read `DESCRIPTION.en_us.html` or `article/ARTICLE.en_us.html`, whichever exists
4. Gather images from the Google Fonts `article/` folder **and** the designer's own
   source repo (de-duplicated by filename — the same promo images often live in both places)
5. Write a short social caption in Claude's own words — matching the length of a
   real Google Fonts post (~40-55 words, 2-3 sentences), not a summary of the whole
   article — and append the `fonts.google.com/specimen/...` link. The designer is always
   credited: if the text does not name every designer listed in `METADATA.pb`, a
   "Designed by …" sentence is added (and without an API key, the same applies to the
   raw description). When `METADATA.pb` names no designer, or says "Multiple Designers",
   the tool warns you to add the name by hand.
6. Flag anything worth a second look: missing info, or images that aren't in an
   Instagram-friendly ratio (1:1, 4:5, or 1.91:1)
7. Let you copy the text directly, or download everything as a `post.txt` + `images/`
   ZIP

Everything runs client-side. There is no backend or database — this is one HTML file.

## Anthropic API key

The post-writing step calls the Claude API **directly from your browser** using a
key you paste into the Settings panel. This uses Anthropic's documented
`anthropic-dangerous-direct-browser-access` header, meant exactly for this kind of
internal, bring-your-own-key tool. A few things worth knowing:

- The key is stored only in **your own browser's `localStorage`** — it is never sent
  anywhere except straight to `api.anthropic.com`. Nobody else who opens the site's
  URL sees your key; it isn't part of the page's source.
- Because the key lives in the browser, don't use this on a shared/public computer,
  and use the "Forget key" button if you need to.
- If you'd rather not paste a key at all, the tool still works — it falls back to
  showing the raw description/article text so you can write the post by hand.
- Get a key at [console.anthropic.com](https://console.anthropic.com) → API Keys.

## How the three input types work

- **Google Fonts URL** (`fonts.google.com/specimen/Name`) or **family name** — looks the
  family straight up in `google/fonts`.
- **`github.com/google/fonts/tree/main/ofl/slug`** — uses that exact slug, no guessing.
- **The designer's own repo** (`github.com/owner/repo`) — guesses a Google Fonts slug from
  the repo name, fetches its `METADATA.pb`, and checks that its `source.repository_url`
  really points back to the repo you pasted, so it doesn't silently show the wrong font.
  If the guess doesn't match (repo name and family slug differ), it falls back to
  searching `google/fonts` for that repo URL — but GitHub's code-search endpoint requires
  authentication with no unauthenticated tier at all, so this fallback only runs if you've
  added a GitHub token in Settings. Without a token, in that situation the tool will ask
  you to also paste the family name or the fonts.google.com URL.

## GitHub token (optional but recommended)

Listing images uses GitHub's REST API, which allows 60 requests/hour without
authentication — plenty for occasional use, but you'll hit it if you generate a lot
of posts back to back. Paste a personal access token (only needs public repo read
access) in Settings to raise that to 5,000/hour. It's stored the same way as the
Anthropic key (your browser only).

## Known limitations

- Only checks Instagram **feed post** ratios (1:1, 4:5, 1.91:1) — not Stories/Reels (9:16).
- Image search in the designer's repo is a best-effort scan for common image files;
  it skips obvious test/CI folders but can still surface unrelated images in repos
  that don't have a dedicated `documentation/`-style folder.
- Some very old font entries only have `DESCRIPTION.en_us.html` and no images at all
  in either location — the tool will say so rather than invent something.
- "Downloadable folder" is a `.zip` — browsers can't write a plain folder to disk
  without extra permissions, so unzip it after downloading.
