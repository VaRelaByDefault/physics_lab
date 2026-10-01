from __future__ import annotations
import numpy as np

from backend.registry import Registry
from backend.models.project import Project

LEAKAGE = 1e-12
ZERO_RESISTANCE = 1e-6
ZERO_TOL_V = 1e-6
ZERO_TOL_I = 1e-9
AMMETER_R = 1e-6
OVERLOAD_I = 1e5


def _clean(value: float, tol: float) -> float:
    return 0.0 if abs(value) < tol else float(value)


def _fmt_amps(x: float) -> str:
    a = abs(x)
    if a >= 1e6:  return f"{x / 1e6:.1f} МА"
    if a >= 1e3:  return f"{x / 1e3:.1f} кА"
    if a >= 1:    return f"{x:.2f} А"
    if a >= 1e-3: return f"{x * 1e3:.2f} мА"
    return f"{x:.2e} А"


class SolveResult:
    def __init__(self, node_voltages: dict, readings: dict, warnings: list[str]):
        self.node_voltages = node_voltages
        self.readings = readings
        self.warnings = warnings

    def to_dict(self) -> dict:
        return {
            "nodes": self.node_voltages,
            "readings": self.readings,
            "warnings": self.warnings,
        }


def solve(project: Project, registry: Registry) -> SolveResult:
    warnings: list[str] = []

    uf: dict[tuple, tuple] = {}

    def find(x):
        uf.setdefault(x, x)
        root = x
        while uf[root] != root:
            root = uf[root]
        while uf[x] != root:
            uf[x], x = root, uf[x]
        return root

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            uf[ra] = rb

    for c in project.components:
        spec = registry.get(c.type)
        for t in spec["terminals"]:
            find(("T", c.id, t["id"]))

    for w in project.connections:
        find(("C", w.id))

    for w in project.connections:
        ck = ("C", w.id)
        for end in w.ends:
            if end.kind == "terminal":
                union(ck, ("T", end.component_id, end.terminal_id))
            elif end.kind == "connection":
                union(ck, ("C", end.connection_id))

    for c in project.components:
        spec = registry.get(c.type)
        if spec["kind"] == "switch":
            inst = registry.create(c.type, c.properties, c.state)
            if inst.is_closed():
                terms = spec["terminals"]
                if not terms:
                    continue
                base = terms[0]["id"]
                for t in terms[1:]:
                    union(("T", c.id, base), ("T", c.id, t["id"]))

    for c in project.components:
        spec = registry.get(c.type)
        kind = spec["kind"]
        if kind != "passive":
            continue
        inst = registry.create(c.type, c.properties, c.state)
        terms = spec["terminals"]

        if c.type == "potentiometer":
            r_aw, r_wb = inst.parts()
            na = ("T", c.id, "a")
            nw = ("T", c.id, "w")
            nb = ("T", c.id, "b")
            if r_aw <= ZERO_RESISTANCE:
                union(na, nw)
            if r_wb <= ZERO_RESISTANCE:
                union(nw, nb)
        else:
            R = inst.resistance()
            if R is not None and R <= ZERO_RESISTANCE:
                union(("T", c.id, terms[0]["id"]),
                      ("T", c.id, terms[1]["id"]))

    node_of_key: dict[tuple, int] = {}

    def node_index(key) -> int:
        root = find(key)
        if root not in node_of_key:
            node_of_key[root] = len(node_of_key)
        return node_of_key[root]

    for c in project.components:
        spec = registry.get(c.type)
        for t in spec["terminals"]:
            node_index(("T", c.id, t["id"]))

    N = len(node_of_key)

    resistors: list[tuple[int, int, float]] = []
    v_sources: list[tuple[int, int, float, str]] = []
    i_sources: list[tuple[int, int, float]] = []
    ammeter_branches: dict[str, tuple[int, int]] = {}

    for c in project.components:
        spec = registry.get(c.type)
        kind = spec["kind"]
        inst = registry.create(c.type, c.properties, c.state)
        terms = spec["terminals"]
        swapped = bool(c.state.get("polarity_swapped", False))

        if kind == "passive" and c.type != "potentiometer":
            n1 = node_index(("T", c.id, terms[0]["id"]))
            n2 = node_index(("T", c.id, terms[1]["id"]))
            R = inst.resistance()
            if R is None:
                warnings.append(f"{c.id}: некорректное сопротивление")
                continue
            if R <= ZERO_RESISTANCE:
                continue
            if n1 == n2:
                continue
            resistors.append((n1, n2, R))

        elif kind == "passive" and c.type == "potentiometer":
            na = node_index(("T", c.id, "a"))
            nw = node_index(("T", c.id, "w"))
            nb = node_index(("T", c.id, "b"))
            r_aw, r_wb = inst.parts()
            if na != nw and r_aw > ZERO_RESISTANCE:
                resistors.append((na, nw, r_aw))
            if nw != nb and r_wb > ZERO_RESISTANCE:
                resistors.append((nw, nb, r_wb))

        elif kind == "source_v":
            if not inst.is_on():
                continue
            n1 = node_index(("T", c.id, terms[0]["id"]))
            n2 = node_index(("T", c.id, terms[1]["id"]))
            if n1 == n2:
                warnings.append(f"{c.id}: закороченный источник напряжения")
                continue
            v = inst.voltage()
            if v is None:
                warnings.append(f"{c.id}: источник не задаёт напряжение")
                continue
            v = float(v)
            if swapped:
                v = -v
            v_sources.append((n1, n2, v, c.id))

        elif kind == "source_i":
            if not inst.is_on():
                continue
            n1 = node_index(("T", c.id, terms[0]["id"]))
            n2 = node_index(("T", c.id, terms[1]["id"]))
            i = inst.current()
            if i is None:
                warnings.append(f"{c.id}: источник не задаёт ток")
                continue
            i = float(i)
            if swapped:
                i = -i
            i_sources.append((n1, n2, i))

        elif kind == "instrument":
            if c.type == "ammeter":
                n1 = node_index(("T", c.id, terms[0]["id"]))
                n2 = node_index(("T", c.id, terms[1]["id"]))
                ammeter_branches[c.id] = (n1, n2)
                if n1 != n2:
                    resistors.append((n1, n2, AMMETER_R))
            elif c.type == "wattmeter":
                ni1 = node_index(("T", c.id, "i_plus"))
                ni2 = node_index(("T", c.id, "i_minus"))
                ammeter_branches[c.id + ":I"] = (ni1, ni2)
                if ni1 != ni2:
                    resistors.append((ni1, ni2, AMMETER_R))

    M = len(v_sources)
    size = (N - 1) + M
    if size <= 0:
        readings: dict[str, dict] = {}
        _run_ohmmeters(project, registry, node_index, N, resistors,
                       readings, warnings)
        return SolveResult({}, readings, warnings)

    A = np.zeros((size, size), dtype=float)
    b = np.zeros(size, dtype=float)

    for n1, n2, R in resistors:
        g = 1.0 / R
        for a, bb, sign in ((n1, n2, -1.0), (n2, n1, -1.0),
                            (n1, n1, +1.0), (n2, n2, +1.0)):
            if a == 0 or bb == 0:
                continue
            A[a - 1, bb - 1] += sign * g

    for i in range(N - 1):
        A[i, i] += LEAKAGE

    for n1, n2, I in i_sources:
        if n1 != 0:
            b[n1 - 1] -= I
        if n2 != 0:
            b[n2 - 1] += I

    for k, (n1, n2, V, _) in enumerate(v_sources):
        row = (N - 1) + k
        if n1 != 0:
            A[n1 - 1, row] += 1.0
            A[row, n1 - 1] += 1.0
        if n2 != 0:
            A[n2 - 1, row] -= 1.0
            A[row, n2 - 1] -= 1.0
        b[row] = V

    x = _solve_linear(A, b)
    if x is None:
        warnings.append("Матрица вырождена, использовано МНК-решение")
        x, *_ = np.linalg.lstsq(A, b, rcond=None)
        if not np.all(np.isfinite(x)):
            x = np.zeros_like(b)

    node_v = np.zeros(N, dtype=float)
    node_v[1:] = x[: N - 1]

    for i in range(N):
        node_v[i] = _clean(node_v[i], ZERO_TOL_V)

    def ammeter_current(cid):
        pair = ammeter_branches.get(cid)
        if pair is None:
            return None
        n1, n2 = pair
        if n1 == n2:
            return 0.0
        dv = float(node_v[n1] - node_v[n2])
        return dv / AMMETER_R

    readings: dict[str, dict] = {}

    for c in project.components:
        spec = registry.get(c.type)
        kind = spec["kind"]
        terms = spec["terminals"]
        swapped = bool(c.state.get("polarity_swapped", False))

        if kind == "instrument":
            if c.type == "voltmeter":
                n_p = node_index(("T", c.id, terms[0]["id"]))
                n_m = node_index(("T", c.id, terms[1]["id"]))
                v = float(node_v[n_p] - node_v[n_m])
                if swapped:
                    v = -v
                readings[c.id] = {
                    "value": _clean(v, ZERO_TOL_V),
                    "unit": spec.get("reading_unit", "В"),
                }

            elif c.type == "ammeter":
                i = ammeter_current(c.id)
                if i is None:
                    i = 0.0
                if swapped:
                    i = -i
                if abs(i) > OVERLOAD_I:
                    warnings.append(
                        f"{c.id}: КЗ источника — ток амперметра превышает "
                        f"предел ({_fmt_amps(i)}). Показание: ∞."
                    )
                    readings[c.id] = {
                        "value": None,
                        "unit": spec.get("reading_unit", "А"),
                        "overload": True,
                        "raw_value": float(i),
                    }
                else:
                    readings[c.id] = {
                        "value": _clean(i, ZERO_TOL_I),
                        "unit": spec.get("reading_unit", "А"),
                    }

            elif c.type == "wattmeter":
                i = ammeter_current(c.id + ":I")
                if i is None:
                    i = 0.0
                nu_p = node_index(("T", c.id, "u_plus"))
                nu_m = node_index(("T", c.id, "u_minus"))
                u = float(node_v[nu_p] - node_v[nu_m])
                readings[c.id] = {
                    "value": _clean(i * u, ZERO_TOL_I * ZERO_TOL_V),
                    "unit": spec.get("reading_unit", "Вт"),
                    "current": _clean(i, ZERO_TOL_I),
                    "voltage": _clean(u, ZERO_TOL_V),
                }
            continue

        if c.type == "lamp":
            n1 = node_index(("T", c.id, terms[0]["id"]))
            n2 = node_index(("T", c.id, terms[1]["id"]))
            u = abs(float(node_v[n1] - node_v[n2]))
            nominal = float(c.properties.get("voltage_nominal", 12.0)) or 12.0
            lit = u >= 0.5 * nominal
            readings[c.id] = {
                "value": _clean(u, ZERO_TOL_V),
                "unit": "В",
                "lit": lit,
            }

    _run_ohmmeters(project, registry, node_index, N, resistors, readings, warnings)

    node_public: dict[str, float] = {}
    inv: dict[int, tuple] = {v: k for k, v in node_of_key.items()}
    for idx, key in inv.items():
        node_public[f"node{idx}"] = float(node_v[idx])

    return SolveResult(node_public, readings, warnings)


def _solve_linear(A, b):
    try:
        return np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return None


def _run_ohmmeters(project, registry, node_index, N, resistors, readings, warnings):
    ohmmeters = [c for c in project.components if c.type == "ohmmeter"]
    if not ohmmeters:
        return

    any_source_on = any(
        registry.create(c.type, c.properties, c.state).is_on()
        for c in project.components
        if registry.get(c.type)["kind"] in ("source_v", "source_i")
    )
    if any_source_on:
        warnings.append(
            "Омметр: в схеме есть включённые источники — "
            "измеряется сопротивление пассивной части"
        )

    for c in ohmmeters:
        try:
            r = _measure_one_ohmmeter(c, registry, node_index, N, resistors)
        except Exception as e:
            warnings.append(f"{c.id}: ошибка измерения ({type(e).__name__})")
            r = None
        if r is None:
            readings[c.id] = {"value": None, "unit": "Ом"}
        else:
            readings[c.id] = {"value": float(r), "unit": "Ом"}


def _measure_one_ohmmeter(c, registry, node_index, N, resistors):
    I0 = 1e-3
    spec = registry.get(c.type)
    terms = spec["terminals"]
    n_p = node_index(("T", c.id, terms[0]["id"]))
    n_m = node_index(("T", c.id, terms[1]["id"]))

    if n_p == n_m:
        return 0.0

    size = N - 1
    if size <= 0:
        return None

    A = np.zeros((size, size))
    b = np.zeros(size)

    for a, bb, R in resistors:
        if R <= ZERO_RESISTANCE:
            continue
        g = 1.0 / R
        for u, v, sign in ((a, bb, -1.0), (bb, a, -1.0),
                           (a, a, +1.0), (bb, bb, +1.0)):
            if u == 0 or v == 0:
                continue
            A[u - 1, v - 1] += sign * g

    for i in range(N - 1):
        A[i, i] += LEAKAGE

    if n_p != 0:
        b[n_p - 1] += I0
    if n_m != 0:
        b[n_m - 1] -= I0

    x = _solve_linear(A, b)
    if x is None:
        x, *_ = np.linalg.lstsq(A, b, rcond=None)

    if not np.all(np.isfinite(x)):
        return None

    vp = 0.0 if n_p == 0 else float(x[n_p - 1])
    vm = 0.0 if n_m == 0 else float(x[n_m - 1])
    r = (vp - vm) / I0

    if not np.isfinite(r):
        return None
    return r