// The Python that runs one script in the worker (runner.ts) and in the Node checks (vsCheck.ts).

/** Runs the script in the worker: the vs module set up over the snapshot, the script's own globals fresh. */
export const RUN_PY = `
import json as _json, traceback as _tb
import sys as _sys, importlib as _importlib
import os as _os
import vs as _vs
_vs._PLUGIN_DIR = _plugin_dir
# a plug-in's own modules: imported fresh each run, as its files may have changed
if _plugin_dir not in _sys.path:
    _sys.path.insert(0, _plugin_dir)
for _n in [k for k, m in list(_sys.modules.items()) if (getattr(m, "__file__", None) or "").startswith(_plugin_dir + "/")]:
    del _sys.modules[_n]
_importlib.invalidate_caches()
_vs._init(_snapshot)
_g = {"__name__": "__main__", "__file__": _file, "vs": _vs}
_err = None
_where = None
try:
    _src = _code
    if _vectorscript:
        import _vsc
        # the plug-in's text files, for {$INCLUDE} (the translator reads them by file name)
        _plugin_files = {}
        for _root, _dirs, _names in _os.walk(_plugin_dir):
            for _nm in _names:
                if _nm.lower().endswith((".px", ".vss", ".vs", ".vsi", ".txt", ".pas", ".inc")):
                    _path = _os.path.join(_root, _nm)
                    with open(_path, "rb") as _fh:
                        _plugin_files[_os.path.relpath(_path, _plugin_dir)] = _fh.read().decode("utf-8", "replace")
        _src, _where = _vsc.translate(_code, _plugin_files)
        _g.update(_vsc.runtime())
    exec(compile(_src, _file, "exec"), _g)
except SystemExit as e:
    if e.code not in (None, 0):
        _err = {"name": "SystemExit", "message": str(e.code), "line": None}
except BaseException as e:
    _line = getattr(e, "lineno", None) if isinstance(e, SyntaxError) and e.filename == _file else None
    for _f in _tb.extract_tb(e.__traceback__):
        if _f.filename == _file:
            _line = _f.lineno
    _name = type(e).__name__
    _msg = str(e)
    if _name == "VsError":
        _name, _line = "Error", e.line
    elif _where is not None:
        if _line is not None:
            _line = _where[_line - 1] if 0 < _line <= len(_where) else None
        if _name == "NotImplementedError":
            _msg = _msg.replace("vs.", "", 1)
    _err = {"name": _name, "message": _msg, "line": _line}
_out = _json.loads(_vs._result()) if _err is None else {}
_out["error"] = _err
_json.dumps(_out)
`;

/**
 * Whether a script is Vectorscript: one that starts (after its comments) with PROCEDURE or FUNCTION,
 * as no Python script does, or a .vs or .px file that doesn't start as Python does.
 */
export function isVectorscript(code: string, file: string): boolean {
  const head = code.replace(/^(\s|\{[^}]*\}|\(\*[\s\S]*?\*\)|\/\/[^\n]*)*/, "");
  if (/^(procedure|function)\s+[a-z_]\w*\s*[;(:]/i.test(head)) return true;
  return /\.(vs|px)$/i.test(file) && !/^\s*(import|from|def|class|#|print\s*\()/.test(code);
}
