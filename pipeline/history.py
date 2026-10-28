"""Facts about each family, read from a blobless clone of google/fonts.

Writes into WORK:
  family_history.json   {last_any, last_binary, first}: family -> [date, commit]
  current_families.txt  one "ofl/name" per line
  current_font_files.txt every current .ttf/.otf path
  commit_refs.json      issue number -> [[date, commit, message]] for commits that cite "#N"
"""
import json, os, re, subprocess


def run(gf, *args):
    return subprocess.run(["git", "-C", gf, *args], check=True, capture_output=True, text=True).stdout


def build(gf, work, ref="origin/main"):
    os.makedirs(work, exist_ok=True)
    log = run(gf, "log", ref, "--format=C %H %cI", "--name-only", "--diff-filter=AMR", "--",
              "ofl/*/*.ttf", "ofl/*/*.otf", "apache/*/*.ttf", "ufl/*/*.ttf",
              "ofl/*/METADATA.pb", "apache/*/METADATA.pb", "ufl/*/METADATA.pb")
    last, lastbin, first = {}, {}, {}
    h = d = None
    for line in log.splitlines():
        if line.startswith("C "):
            _, h, d = line.split(" ")
            continue
        p = line.strip().split("/")
        if len(p) < 3:
            continue
        k = p[0] + "/" + p[1]
        last.setdefault(k, (d, h))
        if p[-1] != "METADATA.pb":
            lastbin.setdefault(k, (d, h))
        first[k] = (d, h)  # log is newest first, so the last one seen is the oldest
    json.dump({"last_any": last, "last_binary": lastbin, "first": first}, open(os.path.join(work, "family_history.json"), "w"))

    fams = run(gf, "ls-tree", "--name-only", ref, "ofl/", "apache/", "ufl/")
    open(os.path.join(work, "current_families.txt"), "w").write(fams)
    files = run(gf, "ls-tree", "-r", "--name-only", ref, "--", "ofl", "apache", "ufl")
    open(os.path.join(work, "current_font_files.txt"), "w").write(
        "\n".join(f for f in files.splitlines() if f.endswith((".ttf", ".otf"))) + "\n")

    refs = {}
    for line in run(gf, "log", ref, "--format=%H%x09%cI%x09%s %b%x1e").split("\x1e"):
        parts = line.strip().split("\t", 2)
        if len(parts) < 3:
            continue
        h, d, msg = parts
        for m in re.finditer(r"(?:google/fonts)?#(\d{2,5})\b", msg):
            if re.search(r"Merge pull request #" + m.group(1) + r"\b", msg):
                continue
            refs.setdefault(int(m.group(1)), []).append((d, h, msg.strip()[:140]))
    json.dump(refs, open(os.path.join(work, "commit_refs.json"), "w"))
    return {"families": len(lastbin), "current": len(fams.splitlines())}
