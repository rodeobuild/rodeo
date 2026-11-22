// (part of the vs module: see index.ts)
//
// Plug-in string resources. A plug-in's .vwr is a folder (or, in older files, a zip) beside the plug-in,
// whose Strings folder holds .vwstrings files of "key" = "value"; lines, UTF-16 or UTF-8, with // comments.
// The files part puts the plug-in's own files under _PLUGIN_DIR, so this part looks in there; a call
// names a file by its path in the .vwr (resIdentifier "Name/Strings/File", the .vwr and .vwstrings
// extensions optional, * matching any part of the file's name). Each file is read when a call first
// needs it, once per run.

export const VS_STRINGS = String.raw`
import fnmatch as _fnmatch
import zipfile as _zipfile

# the .vwr bundles found in this run, the string files read so far (by bundle and file) and their parsed keys
_VWR_BUNDLES = {}
_VWR_SCANNED = []
_VWR_FILES = {}
_VWR_PARSED = {}


def _vwr_run_start(state, snap):
    _VWR_BUNDLES.clear()
    del _VWR_SCANNED[:]
    _VWR_FILES.clear()
    _VWR_PARSED.clear()


_INIT_HOOKS.append(_vwr_run_start)


def _vwr_root():
    # the plug-in folder the files part gives (the check points it at a temporary folder)
    return globals().get("_PLUGIN_DIR") or "/rodeo/plugin"


def _vwr_bundles():
    # {name in lower case: (kind, path)} for each X.vwr under the plug-in folder at any depth: "zip" for
    # a zip file, "dir" for a folder. The first one in sorted order wins when two have a name.
    if _VWR_SCANNED:
        return _VWR_BUNDLES
    _VWR_SCANNED.append(True)
    root = _vwr_root()
    found = {}
    if _os.path.isdir(root):
        for dirpath, dirnames, filenames in _os.walk(root):
            dirnames.sort()
            for d in dirnames:
                if d.lower().endswith(".vwr"):
                    found.setdefault(d[:-4].lower(), ("dir", _os.path.join(dirpath, d)))
            for f in sorted(filenames):
                if f.lower().endswith(".vwr") and _os.path.isfile(_os.path.join(dirpath, f)):
                    found.setdefault(f[:-4].lower(), ("zip", _os.path.join(dirpath, f)))
    _VWR_BUNDLES.update(found)
    return _VWR_BUNDLES


def _vwr_files(kind, path):
    # [(path inside the bundle with / separators, bytes)] for its .vwstrings files, in sorted order
    key = (kind, path)
    if key in _VWR_FILES:
        return _VWR_FILES[key]
    out = []
    if kind == "zip":
        try:
            with _zipfile.ZipFile(path) as z:
                for name in sorted(z.namelist()):
                    if name.lower().endswith(".vwstrings") and not name.endswith("/"):
                        out.append((name.replace("\\", "/"), z.read(name)))
        except (OSError, _zipfile.BadZipFile):
            out = []
    else:
        for dirpath, dirnames, filenames in _os.walk(path):
            dirnames.sort()
            for f in sorted(filenames):
                if f.lower().endswith(".vwstrings"):
                    full = _os.path.join(dirpath, f)
                    rel = _os.path.relpath(full, path).replace(_os.sep, "/")
                    with open(full, "rb") as fh:
                        out.append((rel, fh.read()))
    _VWR_FILES[key] = out
    return out


def _vwr_text(data):
    # the file's text: UTF-16 (with its byte order mark) or UTF-8 (a byte order mark is dropped)
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16")
    return data.decode("utf-8-sig", "replace")


_VWR_ESCAPES = {"n": "\n", "t": "\t", "r": "\r"}


def _vwr_tokens(text):
    # the file's tokens: ("s", string), ("=", None) and (";", None); // and /* */ comments are skipped
    toks = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c == '"':
            buf = []
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\" and i + 1 < n:
                    buf.append(_VWR_ESCAPES.get(text[i + 1], text[i + 1]))
                    i += 2
                else:
                    buf.append(text[i])
                    i += 1
            toks.append(("s", "".join(buf)))
            i += 1
        elif c in "=;":
            toks.append((c, None))
            i += 1
        else:
            i += 1
    return toks


def _vwr_values(kind, path, rel, data):
    # {"exact": {key: value}, "folded": {lower key: value}} for one file, read once per run; a key given twice keeps its first value
    key = (kind, path, rel)
    if key in _VWR_PARSED:
        return _VWR_PARSED[key]
    exact, folded = {}, {}
    toks = _vwr_tokens(_vwr_text(data))
    i = 0
    while i + 2 < len(toks):
        if toks[i][0] == "s" and toks[i + 1][0] == "=" and toks[i + 2][0] == "s":
            k, v = toks[i][1], toks[i + 2][1]
            exact.setdefault(k, v)
            folded.setdefault(k.lower(), v)
            i += 3
        else:
            i += 1
    _VWR_PARSED[key] = {"exact": exact, "folded": folded}
    return _VWR_PARSED[key]


def GetVWRString(resIdentifier, stringIdentifier):
    # The string the key names in the .vwstrings file the path names: "Name/Strings/File" or
    # "Name.vwr/Strings/File.vwstrings", where Name is the plug-in's .vwr (its folder or zip) and File may
    # have * for any part of its name (the first file that has the key answers). Names match in any case;
    # a key matches exactly first, then in any case. "" when there is no such file or key, as Vectorworks gives.
    parts = [p for p in str(resIdentifier).replace("\\", "/").split("/") if p]
    if len(parts) < 2:
        return ""
    name = parts[0]
    if name.lower().endswith(".vwr"):
        name = name[:-4]
    hit = _vwr_bundles().get(name.lower())
    if hit is None:
        return ""
    kind, path = hit
    want_dirs = [p.lower() for p in parts[1:-1]]
    stem = parts[-1]
    if stem.lower().endswith(".vwstrings"):
        stem = stem[:-10]
    want_stem = stem.lower()
    key = str(stringIdentifier)
    for rel, data in _vwr_files(kind, path):
        rel_parts = rel.split("/")
        if [p.lower() for p in rel_parts[:-1]] != want_dirs:
            continue
        base = rel_parts[-1]
        if base.lower().endswith(".vwstrings"):
            base = base[:-10]
        if not _fnmatch.fnmatchcase(base.lower(), want_stem):
            continue
        values = _vwr_values(kind, path, rel, data)
        if key in values["exact"]:
            return values["exact"][key]
        if key.lower() in values["folded"]:
            return values["folded"][key.lower()]
    return ""


def GetPluginString(stringIndex):
    # A plug-in's own numbered strings. Where Vectorworks keeps them isn't known to Rodeo (the plug-in
    # files seen hold none), so this is Rodeo's reading: a string whose key is the number, in a
    # .vwstrings file of the .vwr named as the plug-in is; "" when there is none, as before.
    name = str((_S.plugin or {}).get("name") or "").lower()
    hit = _vwr_bundles().get(name)
    if hit is None:
        return ""
    key = str(int(stringIndex))
    for rel, data in _vwr_files(hit[0], hit[1]):
        values = _vwr_values(hit[0], hit[1], rel, data)
        if key in values["exact"]:
            return values["exact"][key]
    return ""


def GetResourceString(id, index):
    raise NotImplementedError("vs.GetResourceString isn't available in Rodeo yet: use vs.GetVWRString with the plug-in's .vwstrings file")
`;
