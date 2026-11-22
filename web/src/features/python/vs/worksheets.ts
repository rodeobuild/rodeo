// (part of the vs module: see index.ts)
//
// Worksheets: CreateWS and the calls on a worksheet, as Python source appended to the vs module.
// Worksheets in the drawing are read through the snapshot (worksheetsSteps.ts); the steps the run ends
// with are applied there too. The Python keeps each worksheet of the run in _S.wsx.

export const VS_WORKSHEETS = String.raw`# ---- worksheets: CreateWS and the calls on a worksheet ----------------------------------------
# A worksheet is a Handle: "wsnew:N" for one CreateWS made in this run, "ws:N" for one already in the
# drawing (N its name index, as the snapshot lists it). Rows and columns are counted from 1 here, as
# Vectorworks counts them. The run works on its own copy of each worksheet, so a value read back
# answers at once:
#   - a worksheet made in the run is stored when the run ends, as one new worksheet: its columns, its
#     row height and its cells with the formats Rodeo can store (the step "wsnew");
#   - a worksheet already in the drawing takes each cell value as it is set (the step "wsset"); its
#     formats, sizes and other settings are kept for the run only.
# A cell text is a number ("42", "1.5") or text, unless it starts with "=": then it is a formula. The
# formulas Rodeo works out are the functions in _WS_FUNCS on numbers, text and cell references; each
# is stored as its result, because the core can't store a formula yet. A formula Rodeo doesn't work
# out is stored as its text and reported in the run's wsUnevaluated.

import re as _re

_WS_ROWS = 4094
_WS_COLS = 256
# Rodeo's reading: a new column is 72 points wide and a new row 15 points high. Vectorworks states
# widths in pixels; they are taken here as points.
_WS_WIDTH = 72.0
_WS_HEIGHT = 15.0
# the cells a worksheet of more cells than this sends a script are its first ones, in row order
_WS_LIMIT = 5000
_WS_TOKEN = _re.compile(r'\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|("(?:[^"]|"")*")|(\$?[A-Za-z]{1,3}\$?\d+)|([A-Za-z_][A-Za-z_0-9]*)|(#REF!)|(<>|<=|>=|[-+*/^&=<>(),:%]))')
_WS_REF = _re.compile(r'^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$')
_WS_NUMBER = _re.compile(r'^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$')
_WS_FUNCS = ("SUM", "AVERAGE", "MIN", "MAX", "COUNT", "ROUND", "IF", "CONCAT")
# SetWSCellAlignment's codes (General is 4), and the number styles Rodeo stores (the core's codes)
_WS_ALIGN = {1: "left", 2: "center", 3: "right"}
_WS_ALIGN_CODE = {"left": 1, "center": 2, "right": 3}
_WS_STYLES = (0, 1, 2, 3, 4, 5, 6, 11, 12)
# the cell formats a new worksheet stores, by the key of its cell
_WS_STORED = ("align", "bold", "format", "accuracy")


class _WSError(Exception):
    """An error value of a formula, such as #DIV/0!: the cell shows it."""

    def __init__(self, code):
        Exception.__init__(self, code)
        self.code = code


class _WSUnsupported(Exception):
    """A formula Rodeo doesn't work out."""
    pass


class _WSSheet(object):
    def __init__(self, key, name, rows, cols, new):
        self.key = key
        self.name = name
        self.rows = rows
        self.cols = cols
        self.new = new
        # (row, column) 0-based -> {"k": "t" text "s" | "n" number "n" | "f" formula "f" |
        # "c" a formula of the drawing, read as "n" and "s" with its display "d"}
        self.cells = {}
        self.fmt = {}
        self.widths = {}
        self.heights = {}
        self.locks = {}
        self.database = set()
        self.limit = None
        self.visible = True
        self.auto = True
        self.grid_lines = False
        # run only: each cell's borders the script set (1-based key by 0-based cell), the current cell
        # and the selection as the script left it
        self.borders = {}
        self.cur = None
        self.sel = None
        self.op = None


class _WSState(object):
    def __init__(self, snap):
        self.sheets = {}
        self.by_name = {}
        self.new = []
        self.count = 0
        self.names = set(snap.get("wsNames") or [])
        self.drawing_has = False
        self.kept = set()
        self.top = None
        self.current = None
        for w in snap.get("worksheets") or []:
            self.drawing_has = True
            sh = _WSSheet("ws:%d" % w["index"], w["name"], w["rows"], w["cols"], False)
            sh.database = set(i for i, d in enumerate(w.get("database") or []) if d)
            sh.limit = w.get("limit")
            for c in w.get("cells") or []:
                if c["kind"] == "text":
                    cell = {"k": "t", "s": c["text"]}
                elif c["kind"] == "number":
                    cell = {"k": "n", "n": float(c["value"]), "d": c["text"]}
                else:
                    cell = {"k": "c", "n": None if c["value"] is None else float(c["value"]), "s": c["text"], "d": c["text"]}
                sh.cells[(c["row"], c["col"])] = cell
            self.sheets[sh.key] = sh
            self.by_name[sh.name] = sh.key


def _ws_init(state, snap):
    state.wsx = _WSState(snap)


def _ws_handle_named(name):
    # for vs.GetObject: a worksheet of the drawing by its name, as a handle
    key = _S.wsx.by_name.get(name)
    return Handle(key) if key else None


def _ws_sheet(h):
    key = h._id if isinstance(h, Handle) else None
    sh = _S.wsx.sheets.get(key) if key is not None else None
    if sh is None:
        raise ValueError("this is not a worksheet")
    return sh


def _ws_current():
    wx = _S.wsx
    if wx.current is None:
        raise RuntimeError("no worksheet is the target yet: call TargetSprdSheet first")
    return wx.sheets[wx.current]


def _ws_keep(name):
    # a call Rodeo doesn't store: it is kept for this run only
    _S.wsx.kept.add(name)


# ---- cell addresses -----------------------------------------------------------------------------

def _ws_col_letters(c):
    s = ""
    n = c + 1
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def _ws_col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _ws_a1(r, c):
    return _ws_col_letters(c) + str(r + 1)


def _ws_ref_text(r, c, abs_row, abs_col):
    return ("$" if abs_col else "") + _ws_col_letters(c) + ("$" if abs_row else "") + str(r + 1)


def _ws_addr(text):
    m = _WS_REF.match(text)
    if m is None:
        raise _WSUnsupported()
    return int(m.group(4)) - 1, _ws_col_index(m.group(2))


def _ws_check(sh, row, col):
    # a cell named from 1: its 0-based row and column, or the error a call raises
    r = row - 1
    c = col - 1
    if not (0 <= r < sh.rows and 0 <= c < sh.cols):
        raise ValueError("the cell at row %d, column %d is outside the worksheet" % (row, col))
    if sh.limit is not None and r * sh.cols + c >= sh.limit and (r, c) not in sh.cells:
        raise NotImplementedError("this worksheet has more cells than Rodeo gives a script (5,000); this cell is not among them")
    return r, c


def _ws_span(sh, top, left, bottom, right):
    # a range named from 1: its 0-based first row and column and last row and column
    if not (1 <= top <= bottom <= sh.rows and 1 <= left <= right <= sh.cols):
        raise ValueError("the cells from row %d, column %d to row %d, column %d are outside the worksheet" % (top, left, bottom, right))
    return top - 1, left - 1, bottom - 1, right - 1


def _ws_axis(sh, first, last, axis):
    # rows (axis 0) or columns (axis 1) named from 1: their 0-based first and last
    n = sh.cols if axis else sh.rows
    if not (1 <= first <= last <= n):
        raise ValueError("no such %s: %d to %d" % ("columns" if axis else "rows", first, last))
    return first - 1, last - 1


# ---- formulas -----------------------------------------------------------------------------------

def _ws_tokens_parse(text):
    body = text[1:] if text.startswith("=") else text
    body = body.strip()
    if body == "":
        raise _WSUnsupported()
    toks = []
    pos = 0
    while pos < len(body):
        m = _WS_TOKEN.match(body, pos)
        if m is None or m.end() == pos:
            raise _WSUnsupported()
        pos = m.end()
        if m.group(1) is not None:
            toks.append(("n", float(m.group(1))))
        elif m.group(2) is not None:
            toks.append(("s", m.group(2)[1:-1].replace('""', '"')))
        elif m.group(3) is not None:
            toks.append(("r", m.group(3).replace("$", "").upper()))
        elif m.group(4) is not None:
            toks.append(("id", m.group(4).upper()))
        elif m.group(5) is not None:
            toks.append(("err", "#REF!"))
        else:
            toks.append(("op", m.group(6)))
    return _WSParser(toks).parse()


class _WSParser(object):
    def __init__(self, toks):
        self.t = toks
        self.i = 0

    def look(self):
        return self.t[self.i] if self.i < len(self.t) else ("end", None)

    def next(self):
        tok = self.look()
        self.i += 1
        return tok

    def is_op(self, *ops):
        tok = self.look()
        return tok[0] == "op" and tok[1] in ops

    def parse(self):
        node = self.comparison()
        if self.i != len(self.t):
            raise _WSUnsupported()
        return node

    def comparison(self):
        node = self.concat()
        while self.is_op("=", "<>", "<", ">", "<=", ">="):
            op = self.next()[1]
            node = ("cmp", op, node, self.concat())
        return node

    def concat(self):
        node = self.additive()
        while self.is_op("&"):
            self.next()
            node = ("cat", node, self.additive())
        return node

    def additive(self):
        node = self.term()
        while self.is_op("+", "-"):
            op = self.next()[1]
            node = ("bin", op, node, self.term())
        return node

    def term(self):
        node = self.power()
        while self.is_op("*", "/"):
            op = self.next()[1]
            node = ("bin", op, node, self.power())
        return node

    def power(self):
        node = self.unary()
        while self.is_op("^"):
            self.next()
            node = ("bin", "^", node, self.unary())
        return node

    def unary(self):
        if self.is_op("-", "+"):
            op = self.next()[1]
            inner = self.unary()
            return ("neg", inner) if op == "-" else inner
        return self.primary()

    def primary(self):
        kind, value = self.next()
        if kind == "n":
            return ("num", value)
        if kind == "s":
            return ("str", value)
        if kind == "err":
            return ("err", value)
        if kind == "r":
            first = _ws_addr(value)
            if self.is_op(":"):
                self.next()
                kind2, value2 = self.next()
                if kind2 != "r":
                    raise _WSUnsupported()
                return ("range", first, _ws_addr(value2))
            return ("ref", first)
        if kind == "id":
            if self.is_op("("):
                self.next()
                args = []
                if not self.is_op(")"):
                    args.append(self.comparison())
                    while self.is_op(","):
                        self.next()
                        args.append(self.comparison())
                if not self.is_op(")"):
                    raise _WSUnsupported()
                self.next()
                if value not in _WS_FUNCS:
                    raise _WSUnsupported()
                return ("call", value, args)
            if value in ("TRUE", "FALSE"):
                return ("bool", value == "TRUE")
            raise _WSUnsupported()
        if kind == "op" and value == "(":
            node = self.comparison()
            if not self.is_op(")"):
                raise _WSUnsupported()
            self.next()
            return node
        raise _WSUnsupported()


def _ws_finite(x):
    if not _math.isfinite(x):
        raise _WSError("#NUM!")
    return x


def _ws_show(n):
    # a number as General shows it
    if n == int(n) and abs(n) < 1e15:
        return str(int(n))
    return "%.10g" % n


def _ws_text(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return _ws_show(v)
    return v


def _ws_num(v):
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, float):
        return v
    try:
        return float(v)
    except ValueError:
        raise _WSError("#VALUE!")


def _ws_truth(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return v != 0
    raise _WSError("#VALUE!")


def _ws_compare(op, a, b):
    if isinstance(a, str) or isinstance(b, str):
        x = _ws_text(a).lower()
        y = _ws_text(b).lower()
    else:
        x = _ws_num(a)
        y = _ws_num(b)
    if op == "=":
        return x == y
    if op == "<>":
        return x != y
    if op == "<":
        return x < y
    if op == ">":
        return x > y
    if op == "<=":
        return x <= y
    return x >= y


def _ws_scalar(sh, node, env):
    v = _ws_eval(sh, node, env)
    if isinstance(v, list):
        raise _WSError("#VALUE!")
    return v


def _ws_eval(sh, node, env):
    k = node[0]
    if k == "num" or k == "str" or k == "bool":
        return node[1]
    if k == "err":
        raise _WSError(node[1])
    if k == "ref":
        return _ws_value(sh, node[1][0], node[1][1], env)
    if k == "range":
        (r1, c1), (r2, c2) = node[1], node[2]
        out = []
        for r in range(min(r1, r2), max(r1, r2) + 1):
            for c in range(min(c1, c2), max(c1, c2) + 1):
                out.append(_ws_value(sh, r, c, env))
        return out
    if k == "neg":
        return _ws_finite(-_ws_num(_ws_scalar(sh, node[1], env)))
    if k == "cat":
        return _ws_text(_ws_scalar(sh, node[1], env)) + _ws_text(_ws_scalar(sh, node[2], env))
    if k == "bin":
        a = _ws_num(_ws_scalar(sh, node[2], env))
        b = _ws_num(_ws_scalar(sh, node[3], env))
        op = node[1]
        if op == "+":
            return _ws_finite(a + b)
        if op == "-":
            return _ws_finite(a - b)
        if op == "*":
            return _ws_finite(a * b)
        if op == "/":
            if b == 0:
                raise _WSError("#DIV/0!")
            return _ws_finite(a / b)
        try:
            return _ws_finite(_math.pow(a, b))
        except (ValueError, OverflowError):
            raise _WSError("#NUM!")
    if k == "cmp":
        return _ws_compare(node[1], _ws_scalar(sh, node[2], env), _ws_scalar(sh, node[3], env))
    if k == "call":
        return _ws_call(sh, node[1], node[2], env)
    raise _WSUnsupported()


def _ws_call(sh, name, args, env):
    if name == "IF":
        if len(args) not in (2, 3):
            raise _WSUnsupported()
        if _ws_truth(_ws_scalar(sh, args[0], env)):
            return _ws_scalar(sh, args[1], env)
        return _ws_scalar(sh, args[2], env) if len(args) == 3 else False
    if name == "CONCAT":
        return "".join(_ws_text(_ws_scalar(sh, a, env)) for a in args)
    if name == "ROUND":
        if len(args) != 2:
            raise _WSUnsupported()
        x = _ws_num(_ws_scalar(sh, args[0], env))
        f = 10.0 ** int(_ws_num(_ws_scalar(sh, args[1], env)))
        y = _math.floor(abs(x) * f + 0.5) / f
        return _ws_finite(y if x >= 0 else -y)
    if name == "COUNT" and any(a[0] == "str" for a in args):
        # a criteria argument: a database function
        raise _WSUnsupported()
    nums = []
    for a in args:
        v = _ws_eval(sh, a, env)
        if isinstance(v, list):
            # numbers in a range count; text, booleans and empty cells don't
            nums.extend(x for x in v if isinstance(x, float))
        elif v is None:
            continue
        elif name == "COUNT":
            if isinstance(v, float):
                nums.append(v)
        else:
            nums.append(_ws_num(v))
    if name == "SUM":
        return _ws_finite(sum(nums))
    if name == "AVERAGE":
        if not nums:
            raise _WSError("#DIV/0!")
        return _ws_finite(sum(nums) / len(nums))
    if name == "MIN":
        return min(nums) if nums else 0.0
    if name == "MAX":
        return max(nums) if nums else 0.0
    return float(len(nums))


def _ws_cell(sh, r, c):
    # a cell of the run's copy; a cell past a long worksheet's first 5,000 isn't known to a formula
    if sh.limit is not None and r * sh.cols + c >= sh.limit and (r, c) not in sh.cells:
        raise _WSUnsupported()
    return sh.cells.get((r, c))


def _ws_value(sh, r, c, env):
    # the value a formula sees in a cell: text, a number, a boolean, None when empty
    if not (0 <= r < sh.rows and 0 <= c < sh.cols):
        raise _WSError("#REF!")
    cell = _ws_cell(sh, r, c)
    if cell is None:
        return None
    k = cell["k"]
    if k == "t":
        return cell["s"]
    if k == "n":
        return cell["n"]
    if k == "c":
        return cell["n"] if cell["n"] is not None else cell["s"]
    if cell.get("unsup"):
        raise _WSUnsupported()
    key = (sh.key, r, c)
    if key in env:
        raise _WSError("#CYCLE!")
    if "ast" not in cell:
        try:
            cell["ast"] = _ws_tokens_parse(cell["f"])
        except _WSUnsupported:
            cell["unsup"] = True
            raise
    env.append(key)
    try:
        return _ws_eval(sh, cell["ast"], env)
    finally:
        env.pop()


def _ws_read(sh, r, c):
    # what a cell reads as: ("n", number), ("s", text), ("u", formula text) for a formula Rodeo doesn't
    # work out, or ("e", None) when it is empty
    cell = sh.cells.get((r, c))
    if cell is None:
        return "e", None
    k = cell["k"]
    if k == "t":
        return "s", cell["s"]
    if k == "n":
        return "n", cell["n"]
    if k == "c":
        return ("n", cell["n"]) if cell["n"] is not None else ("s", cell["s"])
    try:
        v = _ws_value(sh, r, c, [])
    except _WSError as e:
        return "s", e.code
    except _WSUnsupported:
        return "u", cell["f"]
    if v is None:
        return "n", 0.0
    if isinstance(v, list):
        return "s", "#VALUE!"
    if isinstance(v, bool):
        return "s", ("TRUE" if v else "FALSE")
    if isinstance(v, float):
        return "n", v
    return "s", v


def _ws_string(sh, r, c):
    kind, v = _ws_read(sh, r, c)
    if kind == "e":
        return ""
    if kind == "n":
        cell = sh.cells.get((r, c)) or {}
        if cell.get("d") is not None:
            return cell["d"]
        fmt = sh.fmt.get((r, c)) or {}
        if fmt.get("format") in (1, 2) and fmt.get("accuracy") is not None:
            return "%.*f" % (fmt["accuracy"], v)
        return _ws_show(v)
    return v


def _ws_literal(text):
    # the cell a typed text makes: a formula, a number, text, or None for an empty text
    if text.startswith("="):
        return {"k": "f", "f": text}
    if text.strip() == "":
        return None
    if _WS_NUMBER.match(text.strip()):
        return {"k": "n", "n": float(text.strip())}
    return {"k": "t", "s": text}


def _ws_remap(text, fn):
    # the formula's text with each cell reference passed through fn(row, column, absolute row, absolute
    # column) -> (row, column), or None for #REF!
    head = "=" if text.startswith("=") else ""
    body = text[1:] if head else text
    out = []
    pos = 0
    while pos < len(body):
        m = _WS_TOKEN.match(body, pos)
        if m is None or m.end() == pos:
            raise _WSUnsupported()
        pos = m.end()
        ref = m.group(3)
        if ref is None:
            out.append(m.group(0))
            continue
        lead = m.group(0)[: len(m.group(0)) - len(ref)]
        g = _WS_REF.match(ref)
        if g is None:
            raise _WSUnsupported()
        abs_row = g.group(3) == "$"
        abs_col = g.group(1) == "$"
        at = fn(int(g.group(4)) - 1, _ws_col_index(g.group(2)), abs_row, abs_col)
        if at is None or not (0 <= at[0] < _WS_ROWS and 0 <= at[1] < _WS_COLS):
            out.append(lead + "#REF!")
        else:
            out.append(lead + _ws_ref_text(at[0], at[1], abs_row, abs_col))
    return head + "".join(out)


def _ws_fill_fn(dr, dc):
    # a formula filled over a range moves its relative references by the cell's offset
    def fn(r, c, abs_row, abs_col):
        return (r if abs_row else r + dr, c if abs_col else c + dc)
    return fn


# ---- writing cells ------------------------------------------------------------------------------

def _ws_write(sh, r, c, cell):
    # puts a cell in the run's copy (None empties it); a worksheet already in the drawing also gets its
    # value as a step, so the drawing shows it when the run ends
    old = sh.cells.get((r, c))
    if not sh.new:
        if r in sh.database:
            raise RuntimeError("row %d is a database row, whose cells can't be edited here yet" % (r + 1))
        if old is not None and old["k"] == "c":
            raise RuntimeError("cell %s holds a formula, which can't be changed here yet" % _ws_a1(r, c))
        if cell is None and old is None:
            return
    if cell is None:
        sh.cells.pop((r, c), None)
    else:
        sh.cells[(r, c)] = cell
    if sh.new:
        return
    value = ""
    if cell is not None:
        kind, v = _ws_read(sh, r, c)
        if kind in ("n", "s", "u"):
            value = v
    _S.ops.append(["wsset", sh.key, r, c, value])


def _ws_fmt(sh, r, c, key, value, name, stored=True):
    # one format of a cell (None removes it); a format Rodeo can't store, or any on a worksheet already
    # in the drawing, is kept for the run only
    d = sh.fmt.setdefault((r, c), {})
    if value is None:
        d.pop(key, None)
    else:
        d[key] = value
    if not (stored and sh.new):
        _ws_keep(name)


def _ws_fmt_get(sh, r, c, key, default, what):
    fmt = sh.fmt.get((r, c)) or {}
    if key in fmt:
        return fmt[key]
    if sh.new:
        return default
    raise NotImplementedError("the %s of a cell in a worksheet already in the drawing can't be read yet" % what)


def _ws_retext(cell, fn):
    try:
        return {"k": "f", "f": _ws_remap(cell["f"], fn)}
    except _WSUnsupported:
        return {"k": "f", "f": cell["f"]}


def _ws_restructure(sh, axis, at, count, delete):
    # inserts count rows (axis 0) or columns (axis 1) before the 0-based index at, or deletes them: the cells,
    # formats and sizes move with them, and the formulas that name them follow (a deleted one is #REF!)
    def index(v):
        if delete:
            if at <= v < at + count:
                return None
            return v - count if v >= at + count else v
        return v + count if v >= at else v

    def remap(r, c, abs_row, abs_col):
        if axis == 0:
            nr = index(r)
            return None if nr is None else (nr, c)
        nc = index(c)
        return None if nc is None else (r, nc)

    moved = {}
    for (r, c), cell in sh.cells.items():
        v = index(r if axis == 0 else c)
        if v is not None:
            moved[(v, c) if axis == 0 else (r, v)] = cell
    sh.cells = moved
    for key, cell in sh.cells.items():
        if cell["k"] == "f":
            sh.cells[key] = _ws_retext(cell, remap)
    fmts = {}
    for (r, c), d in sh.fmt.items():
        v = index(r if axis == 0 else c)
        if v is not None:
            fmts[(v, c) if axis == 0 else (r, v)] = d
    sh.fmt = fmts
    sizes = {}
    for pos, size in (sh.heights if axis == 0 else sh.widths).items():
        v = index(pos)
        if v is not None:
            sizes[v] = size
    if not delete:
        # inserted rows or columns take the size of the one above (or the one they were put before)
        src = sizes.get(at - 1) if at > 0 else sizes.get(at + count)
        if src is not None:
            for i in range(at, at + count):
                sizes[i] = src
    if axis == 0:
        sh.heights = sizes
        locks = {}
        for pos, lock in sh.locks.items():
            v = index(pos)
            if v is not None:
                locks[v] = lock
        sh.locks = locks
        sh.rows += -count if delete else count
    else:
        sh.widths = sizes
        sh.cols += -count if delete else count


def _ws_edit_axis(sh, axis, first, count, delete):
    what = "rows" if axis == 0 else "columns"
    if not sh.new:
        raise NotImplementedError("%s can't be inserted or deleted in a worksheet already in the drawing yet" % what)
    n = sh.rows if axis == 0 else sh.cols
    count = int(count)
    if count < 1:
        raise ValueError("the number of %s must be at least 1" % what)
    if delete:
        if not (1 <= first and first + count - 1 <= n):
            raise ValueError("no such %s to delete: %d to %d" % (what, first, first + count - 1))
        size = n - count
    else:
        if not (1 <= first <= n + 1):
            raise ValueError("%s can only be inserted before %d to %d" % (what, 1, n + 1))
        size = n + count
    limit = _WS_ROWS if axis == 0 else _WS_COLS
    if not (1 <= size <= limit):
        raise ValueError("a worksheet can have from 1 to %d %s" % (limit, what))
    _ws_restructure(sh, axis, first - 1, count, delete)


def _ws_kept_span(name):
    # a range call Rodeo accepts and keeps for the run only (borders, merged cells and the like)
    def call(worksheet, topRow, leftColumn, bottomRow, rightColumn, *rest):
        sh = _ws_sheet(worksheet)
        _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
        _ws_keep(name)
        return None
    return call


# ---- the calls ----------------------------------------------------------------------------------

def CreateWS(name, rows, columns):
    wx = _S.wsx
    if not wx.drawing_has:
        raise RuntimeError("this drawing has no worksheet to copy settings from yet, so Rodeo can't make a new worksheet in it")
    rows = int(rows)
    columns = int(columns)
    if not (1 <= rows <= _WS_ROWS):
        raise ValueError("the number of rows must be from 1 to 4094")
    if not (1 <= columns <= _WS_COLS):
        raise ValueError("the number of columns must be from 1 to 256")
    base = str(name).strip() or "Worksheet"
    final = base
    n = 0
    while final in wx.names:
        n += 1
        final = "%s-%d" % (base, n)
    wx.names.add(final)
    wx.count += 1
    key = "wsnew:%d" % wx.count
    sh = _WSSheet(key, final, rows, columns, True)
    sh.op = ["wsnew", key, final, [], _WS_HEIGHT, []]
    _S.ops.append(sh.op)
    wx.sheets[key] = sh
    wx.new.append(sh)
    return Handle(key)


def GetWSRowColumnCount(worksheet):
    sh = _ws_sheet(worksheet)
    return sh.rows, sh.cols


def SetWSCellFormula(worksheet, topRow, leftColumn, bottomRow, rightColumn, formula):
    sh = _ws_sheet(worksheet)
    if leftColumn == 0 or rightColumn == 0:
        raise NotImplementedError("vs.SetWSCellFormula in column 0 (a database row) isn't available in Rodeo yet")
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    text = "" if formula is None else str(formula)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            t = text
            if text.startswith("=") and (r2 > r1 or c2 > c1):
                try:
                    t = _ws_remap(text, _ws_fill_fn(r - r1, c - c1))
                except _WSUnsupported:
                    t = text
            _ws_write(sh, r, c, _ws_literal(t))


SetWSCellFormulaN = SetWSCellFormula


def GetWSCellFormula(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    cell = sh.cells.get((r, c))
    if cell is None:
        return ""
    if cell["k"] == "t":
        return cell["s"]
    if cell["k"] == "n":
        return _ws_show(cell["n"])
    if cell["k"] == "c":
        raise NotImplementedError("the formula of a cell that already holds one in the drawing can't be read yet")
    return cell["f"]


GetWSCellFormulaN = GetWSCellFormula


def GetWSCellValue(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    kind, v = _ws_read(sh, r, c)
    return v if kind == "n" else 0.0


def GetWSCellString(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_string(sh, r, c)


GetWSCellStringN = GetWSCellString


def IsWSCellNumber(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_read(sh, r, c)[0] == "n"


def IsWSCellString(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_read(sh, r, c)[0] in ("s", "u")


def IsValidWSCell(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    return 1 <= row <= sh.rows and 1 <= column <= sh.cols


def IsValidWSRange(worksheet, topRow, leftColumn, bottomRow, rightColumn):
    sh = _ws_sheet(worksheet)
    return 1 <= topRow <= bottomRow <= sh.rows and 1 <= leftColumn <= rightColumn <= sh.cols


def IsWSDatabaseRow(worksheet, databaseRow):
    sh = _ws_sheet(worksheet)
    return (databaseRow - 1) in sh.database


def SetWSColumnWidth(worksheet, fromColumn, toColumn, width):
    sh = _ws_sheet(worksheet)
    c1, c2 = _ws_axis(sh, fromColumn, toColumn, 1)
    for c in range(c1, c2 + 1):
        sh.widths[c] = float(width)
    if not sh.new:
        _ws_keep("SetWSColumnWidth")


def GetWSColumnWidth(worksheet, column):
    sh = _ws_sheet(worksheet)
    c, _last = _ws_axis(sh, column, column, 1)
    if c in sh.widths:
        return int(round(sh.widths[c]))
    if sh.new:
        return int(_WS_WIDTH)
    raise NotImplementedError("the width of a column in a worksheet already in the drawing can't be read yet")


def SetWSRowHeight(worksheet, fromRow, toRow, height, updatePalette, lockHeight):
    sh = _ws_sheet(worksheet)
    r1, r2 = _ws_axis(sh, fromRow, toRow, 0)
    for r in range(r1, r2 + 1):
        sh.heights[r] = float(height)
        sh.locks[r] = bool(lockHeight)
    if not sh.new:
        _ws_keep("SetWSRowHeight")
    elif lockHeight:
        _ws_keep("SetWSRowHeight lock")


def GetWSRowHeight(worksheet, row):
    sh = _ws_sheet(worksheet)
    r, _last = _ws_axis(sh, row, row, 0)
    if r in sh.heights:
        return int(round(sh.heights[r]))
    if sh.new:
        return int(_WS_HEIGHT)
    raise NotImplementedError("the height of a row in a worksheet already in the drawing can't be read yet")


def GetWSRowHLockState(worksheet, row):
    sh = _ws_sheet(worksheet)
    r, _last = _ws_axis(sh, row, row, 0)
    if r in sh.locks:
        return sh.locks[r]
    if sh.new:
        return False
    raise NotImplementedError("the row height lock of a worksheet already in the drawing can't be read yet")


def AutoFitWSRowHeights(worksheet, fromRow, toRow):
    sh = _ws_sheet(worksheet)
    _ws_axis(sh, fromRow, toRow, 0)
    # the heights Vectorworks would fit aren't worked out here: the rows keep their heights
    _ws_keep("AutoFitWSRowHeights")


def InsertWSRows(worksheet, beforeRow, numRows):
    _ws_edit_axis(_ws_sheet(worksheet), 0, beforeRow, numRows, False)


def InsertWSColumns(worksheet, beforeColumn, numColumns):
    _ws_edit_axis(_ws_sheet(worksheet), 1, beforeColumn, numColumns, False)


def DeleteWSRows(worksheet, startRow, numRows):
    _ws_edit_axis(_ws_sheet(worksheet), 0, startRow, numRows, True)


def DeleteWSColumns(worksheet, startColumn, numColumns):
    _ws_edit_axis(_ws_sheet(worksheet), 1, startColumn, numColumns, True)


def ShowWS(worksheet, show):
    sh = _ws_sheet(worksheet)
    sh.visible = bool(show)
    if sh.visible:
        # the editor opens the last worksheet shown, once the run's steps are applied
        _S.ops.append(["wsshow", sh.key])


def IsWSVisible(worksheet):
    return _ws_sheet(worksheet).visible


def RecalculateWS(worksheet):
    # formulas are worked out when a cell is read, so there is nothing to do here
    _ws_sheet(worksheet)


def GetWSAutoRecalcState(worksheet):
    return _ws_sheet(worksheet).auto


def SetWSAutoRecalcState(worksheet, state):
    sh = _ws_sheet(worksheet)
    sh.auto = bool(state)
    _ws_keep("SetWSAutoRecalcState")


def ClearWSCell(worksheet, topRow, leftColumn, bottomRow, rightColumn):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_write(sh, r, c, None)
            if (r, c) in sh.fmt:
                sh.fmt.pop((r, c), None)
                if not sh.new:
                    _ws_keep("ClearWSCell formats")


def SetWSCellNumberFormat(worksheet, topRow, leftColumn, bottomRow, rightColumn, style, accuracy, leaderString, trailerString):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    stored = style in _WS_STYLES
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            if stored:
                _ws_fmt(sh, r, c, "format", int(style), "SetWSCellNumberFormat")
                _ws_fmt(sh, r, c, "accuracy", int(accuracy), "SetWSCellNumberFormat")
            else:
                # styles 7, 8 and 13 (date, conditional, text) aren't stored
                _ws_fmt(sh, r, c, "format", None, "SetWSCellNumberFormat")
                _ws_fmt(sh, r, c, "format_run", int(style), "SetWSCellNumberFormat", False)
            _ws_fmt(sh, r, c, "leader", leaderString, "SetWSCellNumberFormat", False)
            _ws_fmt(sh, r, c, "trailer", trailerString, "SetWSCellNumberFormat", False)


def GetWSCellNumberFormat(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    fmt = sh.fmt.get((r, c)) or {}
    if "format" not in fmt and "format_run" not in fmt and not sh.new:
        raise NotImplementedError("the number format of a cell in a worksheet already in the drawing can't be read yet")
    style = fmt.get("format", fmt.get("format_run", 0))
    return style, fmt.get("accuracy", 0), fmt.get("leader", ""), fmt.get("trailer", "")


def SetWSCellAlignment(worksheet, topRow, leftColumn, bottomRow, rightColumn, cellAlignment):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    code = int(cellAlignment)
    if code not in (1, 2, 3, 4):
        raise ValueError("no such alignment: %d" % code)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "align", _WS_ALIGN.get(code), "SetWSCellAlignment")


def GetWSCellAlignment(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _WS_ALIGN_CODE.get(_ws_fmt_get(sh, r, c, "align", None, "alignment"), 4)


def SetWSCellTextFormat(worksheet, topRow, leftColumn, bottomRow, rightColumn, fontIndex, size, style):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "bold", bool(int(style) & 1), "SetWSCellTextFormat")
            _ws_fmt(sh, r, c, "font", int(fontIndex), "SetWSCellTextFormat", False)
            _ws_fmt(sh, r, c, "size", int(size), "SetWSCellTextFormat", False)
            _ws_fmt(sh, r, c, "italic", bool(int(style) & 2), "SetWSCellTextFormat", False)


def GetWSCellTextFormat(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    fmt = sh.fmt.get((r, c)) or {}
    if not fmt and not sh.new:
        raise NotImplementedError("the text format of a cell in a worksheet already in the drawing can't be read yet")
    # the font and size of a cell the script never set are placeholders: Rodeo doesn't read the drawing's default
    style = (1 if fmt.get("bold") else 0) + (2 if fmt.get("italic") else 0)
    return fmt.get("font", 0), fmt.get("size", 12), style


def SetWSCellFill(worksheet, topRow, leftColumn, bottomRow, rightColumn, style, bgcolor, fgcolor, fillpattern):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "fill", (int(style), int(bgcolor), int(fgcolor), int(fillpattern)), "SetWSCellFill", False)


def GetWSCellFill(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_fmt_get(sh, r, c, "fill", (0, 0, 0, 0), "fill")


def SetWSCellTextColor(worksheet, topRow, leftColumn, bottomRow, rightColumn, color):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "color", int(color), "SetWSCellTextColor", False)


def GetWSCellTextColor(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_fmt_get(sh, r, c, "color", 0, "text colour")


def SetWSCellWrapTextFlag(worksheet, topRow, leftColumn, bottomRow, rightColumn, wrapTextFlag):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "wrap", bool(wrapTextFlag), "SetWSCellWrapTextFlag", False)


def GetWSCellWrapTextFlag(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_fmt_get(sh, r, c, "wrap", False, "wrap flag")


def SetWSCellVertAlignment(worksheet, topRow, leftColumn, bottomRow, rightColumn, vAlignment):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "vert", int(vAlignment), "SetWSCellVertAlignment", False)


def GetWSCellVertAlignment(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_fmt_get(sh, r, c, "vert", 1, "vertical alignment")


def SetWSTextAngle(worksheet, topRow, leftColumn, bottomRow, rightColumn, angle):
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            _ws_fmt(sh, r, c, "angle", int(angle), "SetWSTextAngle", False)


def GetWSCellTextAngle(worksheet, row, column):
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    return _ws_fmt_get(sh, r, c, "angle", 0, "text angle")


# merged cells: accepted and kept for the run only (the merge is not written to the drawing)
for _name in ("WorksheetMergeCells", "WorksheetSplitCells"):
    globals()[_name] = _ws_kept_span(_name)
del _name


# borders the script sets: each cell's four sides are recorded for the run (GetWSCellBorder reads them);
# the drawing's borders are not written, so the calls are kept for the run only
def _ws_border_set(sh, r1, c1, r2, c2, sides_of):
    # sides_of(r1, c1, r2, c2, r, c) gives the sides of one cell that this call sets, and whether they are on
    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            d = sh.borders.setdefault((r, c), {})
            for side, on in sides_of(r1, c1, r2, c2, r, c).items():
                d[side] = on


def SetWSCellBorder(worksheet, topRow, leftColumn, bottomRow, rightColumn, top, left, bottom, right, outline):
    # Rodeo's reading: each flag sets that side on every cell of the range; the outline flag adds nothing
    # on top of them
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    flags = {"top": bool(top), "left": bool(left), "bottom": bool(bottom), "right": bool(right)}
    _ws_border_set(sh, r1, c1, r2, c2, lambda a, b, cc, dd, r, c: flags)
    _ws_keep("SetWSCellBorder")


def SetWSCellBorders(worksheet, topRow, leftColumn, bottomRow, rightColumn, top, left, bottom, right, OutlineInside):
    # the same reading as SetWSCellBorder; OutlineInside is not separate here
    sh = _ws_sheet(worksheet)
    r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
    flags = {"top": bool(top), "left": bool(left), "bottom": bool(bottom), "right": bool(right)}
    _ws_border_set(sh, r1, c1, r2, c2, lambda a, b, cc, dd, r, c: flags)
    _ws_keep("SetWSCellBorders")


def _ws_side_call(name, sides_of):
    # a call that sets sides by a style: style 0 takes the border off, any other style puts it on (Rodeo's reading)
    def call(worksheet, topRow, leftColumn, bottomRow, rightColumn, style, *rest):
        sh = _ws_sheet(worksheet)
        r1, c1, r2, c2 = _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
        on = int(style) != 0

        def on_sides(a, b, cc, dd, r, c):
            return dict((side, on) for side in sides_of(a, b, cc, dd, r, c))
        _ws_border_set(sh, r1, c1, r2, c2, on_sides)
        _ws_keep(name)
        return None
    return call


def _ws_top(a, b, cc, dd, r, c):
    return ["top"]


def _ws_bottom(a, b, cc, dd, r, c):
    return ["bottom"]


def _ws_left(a, b, cc, dd, r, c):
    return ["left"]


def _ws_right(a, b, cc, dd, r, c):
    return ["right"]


def _ws_outline(r1, c1, r2, c2, r, c):
    sides = []
    if r == r1:
        sides.append("top")
    if r == r2:
        sides.append("bottom")
    if c == c1:
        sides.append("left")
    if c == c2:
        sides.append("right")
    return sides


def _ws_inside_horiz(r1, c1, r2, c2, r, c):
    sides = []
    if r > r1:
        sides.append("top")
    if r < r2:
        sides.append("bottom")
    return sides


def _ws_inside_vert(r1, c1, r2, c2, r, c):
    sides = []
    if c > c1:
        sides.append("left")
    if c < c2:
        sides.append("right")
    return sides


for _name, _sides in (
    ("SetWSCellTopBorder", _ws_top), ("SetWSCellTopBN", _ws_top),
    ("SetWSCellBottomBorder", _ws_bottom), ("SetWSCellBottomBN", _ws_bottom),
    ("SetWSCellLeftBorder", _ws_left), ("SetWSCellLeftBN", _ws_left),
    ("SetWSCellRightBorder", _ws_right), ("SetWSCellRightBN", _ws_right),
    ("SetWSCellOutlineBorder", _ws_outline), ("SetWSCellOutlineBN", _ws_outline),
    ("SetWSCellInsideHorizBorder", _ws_inside_horiz), ("SetWSCellInsideHzBN", _ws_inside_horiz),
    ("SetWSCellInsideVertBorder", _ws_inside_vert), ("SetWSCellInsideVtBN", _ws_inside_vert),
):
    globals()[_name] = _ws_side_call(_name, _sides)
del _name, _sides


def GetWSCellBorder(worksheet, row, column):
    # the four sides of a cell the script set this run; a cell of a new worksheet with none set has no border
    sh = _ws_sheet(worksheet)
    r, c = _ws_check(sh, row, column)
    d = sh.borders.get((r, c))
    if d is None:
        if not sh.new:
            raise NotImplementedError("the border of a cell in a worksheet already in the drawing can't be read yet, unless the script set it this run")
        d = {}
    return (bool(d.get("top", False)), bool(d.get("left", False)), bool(d.get("bottom", False)), bool(d.get("right", False)))


# the selection and the current cell: the editor's state, kept for the run only
def SetWSCurrentCell(worksheet, currentCellRow, currentCellColumn):
    sh = _ws_sheet(worksheet)
    _ws_check(sh, currentCellRow, currentCellColumn)
    sh.cur = (int(currentCellRow), int(currentCellColumn))
    sh.sel = None
    _ws_keep("SetWSCurrentCell")


def _ws_sel(sh):
    if sh.sel is not None:
        return sh.sel
    r, c = sh.cur or (1, 1)
    return (r, c, r, c, 0, r, c, 0)


def GetWSSelection(worksheet):
    return _ws_sel(_ws_sheet(worksheet))


def SetWSSelection(worksheet, currentCellRow, currentCellColumn, topRangeRow, leftRangeColumn, topRangeSubrow,
                   bottomRangeRow, rightRangeColumn, bottomRangeSubrow):
    sh = _ws_sheet(worksheet)
    _ws_check(sh, currentCellRow, currentCellColumn)
    _ws_check(sh, topRangeRow, leftRangeColumn)
    _ws_check(sh, bottomRangeRow, rightRangeColumn)
    if int(topRangeSubrow) != 0 or int(bottomRangeSubrow) != 0:
        raise NotImplementedError("a selection of database subrows isn't available in Rodeo yet")
    sh.cur = (int(currentCellRow), int(currentCellColumn))
    sh.sel = (int(currentCellRow), int(currentCellColumn), int(topRangeRow), int(leftRangeColumn), 0,
              int(bottomRangeRow), int(rightRangeColumn), 0)
    _ws_keep("SetWSSelection")


def SetTopVisibleWS(worksheet):
    _S.wsx.top = _ws_sheet(worksheet).key


def GetTopVisibleWS():
    key = _S.wsx.top
    return Handle(key) if key else None


def TargetSprdSheet(h):
    _S.wsx.current = _ws_sheet(h).key


def ActSSheet():
    key = _S.wsx.current
    return Handle(key) if key else None


def SelectSS(h):
    # selects the worksheet in the editor: a display setting
    _ws_sheet(h)


def CloseSS(h):
    _ws_sheet(h)


def LoadCell(row, col, entry):
    sh = _ws_current()
    r, c = _ws_check(sh, row, col)
    _ws_write(sh, r, c, _ws_literal(str(entry)))


def CellValue(row, column):
    sh = _ws_current()
    r, c = _ws_check(sh, row, column)
    kind, v = _ws_read(sh, r, c)
    return v if kind == "n" else 0.0


def CellString(row, column):
    sh = _ws_current()
    r, c = _ws_check(sh, row, column)
    return _ws_string(sh, r, c)


def CellHasNum(h, row, col):
    sh = _ws_sheet(h)
    r, c = _ws_check(sh, row, col)
    return _ws_read(sh, r, c)[0] == "n"


def CellHasStr(h, row, col):
    sh = _ws_sheet(h)
    r, c = _ws_check(sh, row, col)
    return _ws_read(sh, r, c)[0] in ("s", "u")


def GetCellNum(h, row, col):
    return GetWSCellValue(h, row, col)


def GetCellStr(h, row, col):
    return GetWSCellString(h, row, col)


def GetCWidth(h, row, col):
    return GetWSColumnWidth(h, col)


def GetCAlign(h, row, col):
    # the codes of GetCAlign: General 1, Left 2, Right 3, Center 4
    sh = _ws_sheet(h)
    r, c = _ws_check(sh, row, col)
    a = _ws_fmt_get(sh, r, c, "align", None, "alignment")
    return {"left": 2, "right": 3, "center": 4}.get(a, 1)


def EnableDrawingWorksheetPalette(enable, worksheet):
    # the palette of the worksheet window: a display setting
    return None


def SetWorksheetGridLinesVisibility(h, visible):
    # the gridlines are a display setting Rodeo doesn't store: kept for the run
    sh = _ws_sheet(h)
    sh.grid_lines = bool(visible)
    _ws_keep("SetWorksheetGridLinesVisibility")


def AreWorksheetGridLinesVisible(h):
    return _ws_sheet(h).grid_lines


def _ws_finish(state):
    # the run's worksheets, as the steps the run ends with: each made worksheet with its cells, row by row
    wx = state.wsx
    unevaluated = []
    for sh in wx.new:
        widths = [sh.widths.get(c, _WS_WIDTH) for c in range(sh.cols)]
        heights = set(sh.heights.get(r, _WS_HEIGHT) for r in range(sh.rows))
        if len(heights) == 1:
            height = heights.pop()
        else:
            height = _WS_HEIGHT
            _ws_keep("SetWSRowHeight (rows of different heights)")
        grid = []
        for r in range(sh.rows):
            row = []
            for c in range(sh.cols):
                row.append(_ws_out(sh, r, c, unevaluated))
            grid.append(row)
        sh.op[3] = widths
        sh.op[4] = height
        sh.op[5] = grid
    return {"wsUnevaluated": unevaluated, "wsKept": sorted(wx.kept)}


def _ws_out(sh, r, c, unevaluated):
    fmt = sh.fmt.get((r, c)) or {}
    out = dict((k, fmt[k]) for k in _WS_STORED if k in fmt)
    if (r, c) not in sh.cells:
        if not out:
            return None
        out["value"] = ""
        return out
    kind, v = _ws_read(sh, r, c)
    if kind == "u":
        unevaluated.append({"sheet": sh.name, "cell": _ws_a1(r, c), "formula": v})
    out["value"] = v if kind in ("n", "s", "u") else ""
    return out


def _ws_image_obj(h):
    o = _S.objs.get(h._id) if isinstance(h, Handle) and isinstance(h._id, str) else None
    return o if o is not None and o.get("type") == 56 else None


def GetWSFromImage(worksheetImage):
    o = _ws_image_obj(worksheetImage)
    if o is None:
        raise ValueError("this is not a worksheet image")
    key = "ws:%d" % int(o["worksheet"]) if o.get("worksheet") is not None else None
    if key is None or key not in _S.wsx.sheets:
        raise NotImplementedError("the worksheet this image shows can't be read yet")
    return Handle(key)


def GetWSImage(worksheet):
    # the drawing's worksheet image that shows this worksheet, or None; a worksheet made in this run has none yet
    sh = _ws_sheet(worksheet)
    if not sh.key.startswith("ws:"):
        return None
    index = int(sh.key[3:])
    for oid, o in _S.objs.items():
        if o.get("type") == 56 and o.get("worksheet") == index:
            return Handle(oid)
    return None


def _ws_img_target(h):
    # a worksheet image, or a worksheet: what the display settings below are about
    if isinstance(h, Handle) and isinstance(h._id, str) and h._id.startswith(("ws:", "wsnew:")):
        return _ws_sheet(h)
    o = _ws_image_obj(h)
    if o is None:
        raise ValueError("this is not a worksheet or a worksheet image")
    return o


def _ws_img_span_setter(name):
    # a display setting of the cells a worksheet image shows: kept for the run only
    def call(worksheet, topRow, leftColumn, bottomRow, rightColumn, *value):
        sh = _ws_sheet(worksheet)
        _ws_span(sh, topRow, leftColumn, bottomRow, rightColumn)
        _ws_keep(name)
    return call


def _ws_img_setter(name):
    # a display setting of an image object or its worksheet: kept for the run only
    def call(handle, *value):
        _ws_img_target(handle)
        _ws_keep(name)
    return call


for _name in ("SetWSImgAngle", "SetWSImgComponent", "SetWSImgMarginSize", "SetWSImgRenderMode", "SetWSImgScale",
              "SetWSImgSize", "SetWSImgSizeType", "SetWSImgType", "SetWSImgUseLayScale", "SetWSImgUseObjectImg",
              "SetWSImgView", "SetWSPlacement"):
    globals()[_name] = _ws_img_span_setter(_name)
for _name in ("SetWSImgShowDBHeader", "SetWSImageScaleF"):
    globals()[_name] = _ws_img_setter(_name)
del _name


def SetWSCellsImgDPIRes(worksheet, dpiResolution):
    sh = _ws_sheet(worksheet)
    _ws_keep("SetWSCellsImgDPIRes")


# the object name and type of a worksheet handle: a worksheet is type 18 and is named as it is in the drawing;
# the core and the records part answer for everything else
_ws_core_GetObject = GetObject


def GetObject(name):
    h = _ws_core_GetObject(name)
    if h is None:
        h = _ws_handle_named(name)
    return h


def _ws_is_handle(h):
    return isinstance(h, Handle) and isinstance(h._id, str) and h._id in _S.wsx.sheets


_ws_core_GetName = GetName


def GetName(h):
    # a nil handle has no name: Vectorworks answers an empty string
    if h is None:
        return ""
    if _ws_is_handle(h):
        return _S.wsx.sheets[h._id].name
    return _ws_core_GetName(h)


_ws_core_GetTypeN = GetTypeN


def GetTypeN(h):
    # a nil handle has no type: Vectorworks answers 0
    if h is None:
        return 0
    if _ws_is_handle(h):
        return 18
    return _ws_core_GetTypeN(h)


GetType = GetTypeN


_INIT_HOOKS.append(_ws_init)
_RESULT_HOOKS.append(_ws_finish)
`;
