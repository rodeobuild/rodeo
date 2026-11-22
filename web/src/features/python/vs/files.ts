// (part of the vs module: see index.ts)
//
// Folders and files for a script. A browser has no disk, so the files a script sees are kept in the
// Python runtime's own file system (in memory, Pyodide's), under _FILES_ROOT (/rodeo in the browser):
//   plugin/     the plug-in's own folder, written for each run (runner.ts's writeModules), where
//               GetFolderPath answers for the plug-in folders and FindFileInPluginFolder searches
//   files/      the files the user chose with GetFile, GetFileN (read as bytes when chosen)
//   out/        what the script writes: PutFile's files, and the files Rewrite, Append or CreateFolder
//               make. When a run ends without error they are handed to the user as downloads.
//   document/   the drawing's folder: GetFPathName gives a file in it, and files written there are handed over too
//   folders/n/  the folder GetFolderPath gives for any other number, empty and made on demand
// Every run starts with those folders empty (except plugin/, which the worker rebuilds).

export const VS_FILES = String.raw`
import base64 as _b64
import os as _os
import shutil as _shutil

# where the file system's folders are (the check redirects it to a temporary folder); the plug-in's
# folder is set by RUN_PY for each run
_FILES_ROOT = "/rodeo"
_PLUGIN_DIR = "/rodeo/plugin"
# the folder numbers that are the plug-ins' folders (the user's and the application's); -13 is as the
# plug-in folders are given, though the reference's appendix names 13 the Libraries folder
_PLUGIN_FOLDER_NUMBERS = (2, -2, 3, -3, 5, -5, -13)
# the most a script may read from the user or hand back as downloads, in all
_FILE_LIMIT = 50 * 1024 * 1024
_BAD_NAME_CHARS = '/:*?"<>|\\'
# the open text files by path: {"mode": "r", "text", "pos"} or {"mode": "w", "fh"}; and the current
# file for reading (Read, ReadLn, StdRead...) and for writing (Write, WriteLn, Tab, Space)
_FILE_OPEN = {}
_FILE_CUR = {"in": None, "out": None}
# GetLastFileErr's code, and whether a failed file call alerts (UseDefaultFileErrorHandling)
_FILE_ERR = [0]
_FILE_ALERTS = [True]
# the drawing's file name, as the run's snapshot gives it ("" for a drawing not saved yet)
_DRAWING_NAME = [""]


def _files_home():
    return _FILES_ROOT.rstrip("/")


def _locate(name, write=False):
    # The real path a script's file name is kept at. A path under the file system's folders or the
    # plug-in's is used as it is. Other names are read from the first of these that exists: files/,
    # out/, the drawing's folder, the plug-in's folder (also by the file name alone, as a Vectorworks
    # path to the application folder would name it). Writing always goes to out/. A Mac path in HFS
    # form (Name:Folder:file) is taken with its colons as slashes.
    n = str(name).replace("\\", "/")
    if ":" in n and "/" not in n and n[1:2] != ":":
        n = n.replace(":", "/")
    home = _files_home()
    plug = _PLUGIN_DIR.rstrip("/")
    if n.startswith(home + "/") or n.startswith(plug + "/"):
        return n
    absolute = n.startswith("/") or n[1:2] == ":"
    base = n.rsplit("/", 1)[-1] if absolute else n
    if write:
        return home + "/out/" + base
    rel = base if absolute else n
    for cand in (home + "/files/" + rel, home + "/out/" + rel, home + "/document/" + base, plug + "/" + rel, plug + "/" + base):
        if _os.path.exists(cand):
            return cand
    hit = _find_in_plugin(base)
    if hit is not None:
        return hit[0] + "/" + hit[1]
    return home + "/files/" + rel


def _find_in_plugin(filename):
    # (folder, file name) of the first file in the plug-in's folder, at any depth, whose name is filename (any case)
    want = str(filename).lower()
    if not want:
        return None
    for root, dirs, names in _os.walk(_PLUGIN_DIR):
        dirs.sort()
        for nm in sorted(names):
            if nm.lower() == want:
                return (root, nm)
    return None


def _clean_name(name):
    # a file name without the folder part and the characters a file name can't hold
    base = str(name).replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(c for c in base if c not in _BAD_NAME_CHARS).strip()


def _file_fail(code, message):
    # a failed file call: its code for GetLastFileErr, and an alert unless the script turned those off
    _FILE_ERR[0] = code
    if _FILE_ALERTS[0]:
        _S.alerts.append(message)
    return None


def _file_raise(code, message):
    _FILE_ERR[0] = code
    raise RuntimeError(message)


def _find_open(name):
    # the real path of an open file the name is for (opened for reading or for writing), or None
    for write in (False, True):
        path = _locate(name, write)
        if path in _FILE_OPEN:
            return path
    return None


def _open_file(path, mode):
    # opens a real path: "r" to read it whole, "w" or "a" to write (Rewrite, Append, PutFile)
    if mode == "r":
        if not _os.path.isfile(path):
            return _file_fail(6, "Vectorworks couldn't open %s: File or directory not found." % path.rsplit("/", 1)[-1])
        with open(path, "rb") as fh:
            text = fh.read().decode("utf-8", "replace")
        _FILE_OPEN[path] = {"mode": "r", "text": text, "pos": 0}
        _FILE_CUR["in"] = path
    else:
        _os.makedirs(_os.path.dirname(path) or ".", exist_ok=True)
        old = _FILE_OPEN.pop(path, None)
        if old is not None and old.get("fh") is not None:
            old["fh"].close()
        fh = open(path, "w" if mode == "w" else "a", encoding="utf-8", newline="")
        _FILE_OPEN[path] = {"mode": "w", "fh": fh}
        _FILE_CUR["out"] = path
    _FILE_ERR[0] = 0
    return path


def _files_run_start(state, snap):
    # every run starts with no open files and with the folders it made in an earlier run gone
    _DRAWING_NAME[0] = str(snap.get("fileName") or "")
    for f in _FILE_OPEN.values():
        if f.get("fh") is not None:
            try:
                f["fh"].close()
            except OSError:
                pass
    _FILE_OPEN.clear()
    _FILE_CUR["in"] = None
    _FILE_CUR["out"] = None
    _FILE_ERR[0] = 0
    _FILE_ALERTS[0] = True
    for sub in ("folders", "files", "out", "document"):
        _shutil.rmtree(_files_home() + "/" + sub, ignore_errors=True)


def _files_run_end(state):
    # the files the run left in out/ and document/, for the editor to hand over (under the limit in all)
    for path, f in list(_FILE_OPEN.items()):
        if f.get("fh") is not None:
            f["fh"].close()
    _FILE_OPEN.clear()
    found = []
    total = 0
    for sub in ("out", "document"):
        for root, dirs, names in _os.walk(_files_home() + "/" + sub):
            dirs.sort()
            for nm in sorted(names):
                path = _os.path.join(root, nm)
                size = _os.path.getsize(path)
                if total + size > _FILE_LIMIT:
                    state.messages.append("%s wasn't handed over: the files a script leaves come to more than 50 MB." % nm)
                    continue
                total += size
                with open(path, "rb") as fh:
                    found.append({"name": nm, "base64": _b64.b64encode(fh.read()).decode("ascii")})
    return {"files": found} if found else {}


_INIT_HOOKS.append(_files_run_start)
_RESULT_HOOKS.append(_files_run_end)


# ---- folders -------------------------------------------------------------------------------------

def GetFolderPath(whichPath):
    # The plug-in folders answer the plug-in's own folder, with a trailing slash. Any other number
    # answers a folder of the file system, made on demand and empty: Rodeo has no folders of the
    # user's disk, so the application's folders are empty here.
    n = int(whichPath)
    if n in _PLUGIN_FOLDER_NUMBERS:
        return _PLUGIN_DIR.rstrip("/") + "/"
    path = _files_home() + "/folders/%d/" % n
    _os.makedirs(path, exist_ok=True)
    return path


def FindFileInPluginFolder(filename):
    # (found, folder): the folder of the plug-in's file with that name, with a trailing slash, as the
    # reference's example joins the name onto it (Rodeo's reading: the path is a folder)
    hit = _find_in_plugin(filename)
    if hit is None:
        return (False, "")
    return (True, hit[0].rstrip("/") + "/")


def FindFile(whichPath, relFilePath):
    # (found, path) for relFilePath in the folder whichPath names
    p = GetFolderPath(whichPath).rstrip("/") + "/" + str(relFilePath).replace("\\", "/").lstrip("/")
    if _os.path.exists(p):
        return (True, p)
    return (False, "")


def CreateFolder(path):
    try:
        _os.makedirs(_locate(path, True), exist_ok=True)
        return True
    except OSError:
        return False


def GetFilesInFolder(folderName, index):
    # the file name at position index (counted from 1, Rodeo's reading) in the folder, or "" past the last
    try:
        names = sorted(n for n in _os.listdir(_locate(folderName)) if _os.path.isfile(_os.path.join(_locate(folderName), n)))
    except OSError:
        return ""
    i = int(index) - 1
    return names[i] if 0 <= i < len(names) else ""


def GetFileSize(FilePath):
    # (size in bytes, FilePath), the size -1 when there is no such file
    p = _locate(FilePath)
    if _os.path.isfile(p):
        return (_os.path.getsize(p), FilePath)
    return (-1, FilePath)


def GetFileInfo(filename):
    # the file's read and write paths, whether each exists, and what it may do: the write path is in out/
    read = _locate(filename)
    write = _locate(filename, True)
    can_read = _os.path.isfile(read)
    return (read, write, can_read, _os.path.isfile(write), False, can_read and _os.access(read, _os.R_OK), True, True)


def GetFolder(promptStr):
    # Rodeo can't give a script a folder of the user's disk: the choice answers as cancelled
    _S.cancelled = True
    return (-1, "")


def ConvertHSF2PosixPath(HSFPath):
    # a Mac path with colons, made with slashes (Macintosh HD:Folder becomes /Macintosh HD/Folder)
    s = str(HSFPath)
    if ":" not in s:
        return (False, s)
    return (True, "/" + s.replace(":", "/"))


def ConvertPosix2HSFPath(PosixPath):
    s = str(PosixPath)
    if not s.startswith("/"):
        return (False, s)
    return (True, s[1:].replace("/", ":"))


# ---- the drawing's name --------------------------------------------------------------------------

def GetFName():
    return _DRAWING_NAME[0]


def GetFPathName():
    # the drawing's file in the document folder, or "" for a drawing not saved yet
    name = _DRAWING_NAME[0]
    return _files_home() + "/document/" + name if name else ""


def GetLastFileErr():
    return _FILE_ERR[0]


def UseDefaultFileErrorHandling(enable):
    # Rodeo's alert for a failed file call is the editor's message after the run, so this only chooses whether it is given
    _FILE_ALERTS[0] = bool(enable)


# ---- choosing files -------------------------------------------------------------------------------

def _pick_file(title, mask):
    # the file the user chooses in the editor's file picker, written to files/ (its path), or None
    got = _json.loads(_host("OpenFile", str(title), str(mask)))
    _S.cancelled = got is None
    if got is None:
        return None
    if got.get("error"):
        raise RuntimeError(got["error"])
    path = _files_home() + "/files/" + (_clean_name(got.get("name", "")) or "file")
    _os.makedirs(_os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(_b64.b64decode(got.get("base64", "")))
    return path


def GetFile():
    return _pick_file("Choose a file", "") or ""


def GetFileN(title, defaultFolder, mask, *more):
    # defaultFolder isn't used: the editor's picker has no folder of the user's disk to start in.
    # Scripts also pass a fourth text, a Windows-style filter such as "CSV|*.csv": Rodeo's reading is
    # that it names the file types when mask is empty (the reference has three arguments only).
    if not mask and more and more[0]:
        mask = ";".join(p.strip().lstrip("*").lstrip(".") for p in str(more[0]).split("|")[-1].split(";") if p.strip())
    path = _pick_file(title, mask)
    return (path is not None, path or "")


def PutFile(commentStr, defaultStr):
    # asks the name of the file to write (the editor's text prompt, with defaultStr as the name), then
    # opens it for writing in out/ and answers its path; "" when cancelled
    got = _json.loads(_host("StrDialog", str(commentStr), str(defaultStr)))
    _S.cancelled = got is None
    if got is None:
        return ""
    name = _clean_name(got) or _clean_name(defaultStr)
    if not name:
        return ""
    return _open_file(_locate(name, True), "w")


# ---- web addresses -------------------------------------------------------------------------------

def OpenURL(URLname):
    # opens a web address in a new browser tab; a local file or another scheme isn't opened
    url = str(URLname).strip()
    if not url.lower().startswith(("http://", "https://")):
        return False
    return bool(_json.loads(_host("OpenURL", url)))


# ---- opening, writing and reading text files ------------------------------------------------------

def Open(fileName):
    _open_file(_locate(fileName), "r")


def Rewrite(fileName):
    _open_file(_locate(fileName, True), "w")


def Append(fileName):
    _open_file(_locate(fileName, True), "a")


def Close(fileName):
    path = _find_open(fileName)
    if path is None:
        _FILE_ERR[0] = 7
        return None
    f = _FILE_OPEN.pop(path)
    if f.get("fh") is not None:
        f["fh"].close()
    if _FILE_CUR["in"] == path:
        _FILE_CUR["in"] = None
    if _FILE_CUR["out"] == path:
        _FILE_CUR["out"] = None
    _FILE_ERR[0] = 0
    return None


def EOF(fileName):
    path = _find_open(fileName)
    if path is None or _FILE_OPEN[path]["mode"] != "r":
        _FILE_ERR[0] = 7
        return True
    f = _FILE_OPEN[path]
    return f["pos"] >= len(f["text"])


def EOLN(fileName):
    path = _find_open(fileName)
    if path is None or _FILE_OPEN[path]["mode"] != "r":
        _FILE_ERR[0] = 7
        return True
    f = _FILE_OPEN[path]
    return f["pos"] >= len(f["text"]) or f["text"][f["pos"]] in "\r\n"


_KIND_NAMES = {
    "integer": "int", "longint": "int", "int": "int", int: "int",
    "real": "float", "double": "float", "float": "float", float: "float",
    "boolean": "bool", "bool": "bool", bool: "bool",
    "char": "char",
    "string": "str", "str": "str", str: "str",
}


def _kind_of(kind):
    # the kind a value is read as: "int", "float", "bool", "char" or "str"; None when it is worked out from the text
    if kind is None:
        return None
    key = kind if isinstance(kind, type) else str(kind).strip().lower()
    return _KIND_NAMES.get(key, "str")


def _read_convert(tok, k, who):
    if k == "int" or k == "float":
        try:
            return int(tok) if k == "int" else float(tok)
        except ValueError:
            _file_raise(-1, "%s couldn't read %r as a number." % (who, tok))
    if k == "bool":
        u = tok.strip().upper()
        if u in ("TRUE", "FALSE"):
            return u == "TRUE"
        _file_raise(-1, "%s couldn't read %r as TRUE or FALSE." % (who, tok))
    if k is None:
        for cast in (int, float):
            try:
                return cast(tok)
            except ValueError:
                pass
        if tok.strip().upper() in ("TRUE", "FALSE"):
            return tok.strip().upper() == "TRUE"
    return tok


def _read_values(kinds, std, line_end, who):
    # the values read from the current file: each as its kind says (None: a number if the text is one,
    # else a string). Read and ReadLn skip spaces and tabs between numbers and stop a string at a tab;
    # StdRead and StdReadLn take a string to the end of the line. ReadLn and StdReadLn then go to the next line.
    p = _FILE_CUR["in"]
    if p is None or p not in _FILE_OPEN or _FILE_OPEN[p]["mode"] != "r":
        _file_raise(7, "%s: no file is open for reading. Call Open first." % who)
    f = _FILE_OPEN[p]
    text = f["text"]
    pos = f["pos"]
    values = []
    for kind in (kinds or (None,)):
        if pos >= len(text):
            f["pos"] = pos
            _file_raise(4, "%s reached the end of the file." % who)
        k = _kind_of(kind)
        if k == "char":
            values.append(text[pos])
            pos += 1
            f["pos"] = pos
            continue
        if k == "str" or k is None:
            # a value without a kind is read as a string when it isn't a number: up to the tab or the line's end
            if not std:
                while pos < len(text) and text[pos] == " ":
                    pos += 1
            stops = "\r\n" if std else "\t\r\n"
        else:
            while pos < len(text) and text[pos] in " \t":
                pos += 1
            stops = " \t\r\n"
        end = pos
        while end < len(text) and text[end] not in stops:
            end += 1
        values.append(_read_convert(text[pos:end], k, who))
        pos = end
        f["pos"] = pos
    if line_end:
        while pos < len(text) and text[pos] not in "\r\n":
            pos += 1
        if text.startswith("\r\n", pos):
            pos += 2
        elif pos < len(text):
            pos += 1
        f["pos"] = pos
    return values


def _read_result(values):
    return values[0] if len(values) == 1 else tuple(values)


def ReadLn(*kinds):
    # the next value or values on the current file's line, then the next line; with kinds, each read as
    # its kind (int, float, bool, str or char, or the Pascal names); with none, the value is worked out
    return _read_result(_read_values(kinds, False, True, "ReadLn"))


def Read(*kinds):
    return _read_result(_read_values(kinds, False, False, "Read"))


def StdReadLn(*kinds):
    return _read_result(_read_values(kinds, True, True, "StdReadLn"))


def StdRead(*kinds):
    return _read_result(_read_values(kinds, True, False, "StdRead"))


def _file_text(x):
    if isinstance(x, bool):
        return "TRUE" if x else "FALSE"
    return str(x)


def _write_text(text, who):
    p = _FILE_CUR["out"]
    if p is None or p not in _FILE_OPEN or _FILE_OPEN[p]["mode"] != "w":
        _file_raise(7, "%s: no file is open for writing. Call Rewrite, Append or PutFile first." % who)
    _FILE_OPEN[p]["fh"].write(text)


def Write(*z):
    _write_text("".join(_file_text(x) for x in z), "Write")


def WriteLn(*z):
    _write_text("".join(_file_text(x) for x in z) + "\n", "WriteLn")


def WriteMac(*z):
    # the same, with the Mac's line end (a carriage return)
    _write_text("".join(_file_text(x) for x in z), "WriteMac")


def WriteLnMac(*z):
    _write_text("".join(_file_text(x) for x in z) + "\r", "WriteLnMac")


def Tab(n):
    _write_text("\t" * int(n), "Tab")


def Space(n):
    _write_text(" " * int(n), "Space")
`;
