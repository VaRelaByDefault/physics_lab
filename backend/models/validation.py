from __future__ import annotations
from backend.registry import Registry
from backend.models.project import Project


class ValidationError(Exception):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def validate_project(project: Project, registry: Registry) -> None:
    errors: list[str] = []

    known_types = set(registry.items().keys())
    for c in project.components:
        if c.type not in known_types:
            errors.append(f"Компонент {c.id}: неизвестный тип '{c.type}'")

    term_index: dict[str, set[str]] = {}
    for c in project.components:
        if c.type not in known_types:
            continue
        term_index[c.id] = {t["id"] for t in registry.get(c.type)["terminals"]}

    comp_ids = {c.id for c in project.components}
    conn_ids = {w.id for w in project.connections}

    for w in project.connections:
        if len(w.ends) != 2:
            errors.append(f"Соединение {w.id}: должно быть ровно 2 конца")
            continue
        for end in w.ends:
            if end.kind == "terminal":
                if end.component_id not in comp_ids:
                    errors.append(f"Соединение {w.id}: нет компонента '{end.component_id}'")
                elif end.terminal_id not in term_index.get(end.component_id, set()):
                    errors.append(
                        f"Соединение {w.id}: у '{end.component_id}' "
                        f"нет терминала '{end.terminal_id}'"
                    )
            elif end.kind == "connection":
                if end.connection_id not in conn_ids:
                    errors.append(f"Соединение {w.id}: нет соединения '{end.connection_id}'")
                elif end.connection_id == w.id:
                    errors.append(f"Соединение {w.id}: ссылается само на себя")
            elif end.kind == "free":
                if end.x is None or end.y is None:
                    errors.append(f"Соединение {w.id}: у свободного конца нет координат")
            else:
                errors.append(f"Соединение {w.id}: неизвестный kind='{end.kind}'")

    # Если уже есть ошибки — цикл-чек не имеет смысла и может упасть на «мусоре».
    if errors:
        raise ValidationError(errors)

    # Проверка циклов между соединениями
    adj: dict[str, list[str]] = {w.id: [] for w in project.connections}
    for w in project.connections:
        for end in w.ends:
            if end.kind == "connection" and end.connection_id in adj:
                adj[w.id].append(end.connection_id)

    color: dict[str, int] = {k: 0 for k in adj}

    def dfs(u: str) -> bool:
        color[u] = 1
        for v in adj[u]:
            if v not in color:
                continue
            if color[v] == 1:
                return True
            if color[v] == 0 and dfs(v):
                return True
        color[u] = 2
        return False

    if any(color[u] == 0 and dfs(u) for u in adj):
        errors.append("Обнаружен цикл среди соединений")

    if errors:
        raise ValidationError(errors)