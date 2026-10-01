from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ComponentInstance:
    id: str
    type: str
    position: dict
    rotation: int = 0
    properties: dict = field(default_factory=dict)
    state: dict = field(default_factory=dict)
    style: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ComponentInstance":
        return cls(
            id=d["id"], type=d["type"], position=d["position"],
            rotation=d.get("rotation", 0),
            properties=dict(d.get("properties", {})),
            state=dict(d.get("state", {})),
            style=dict(d.get("style", {})),
        )


@dataclass
class ConnectionEnd:
    kind: str                                # "terminal" | "connection" | "free"
    component_id: str | None = None
    terminal_id: str | None = None
    connection_id: str | None = None
    anchor: float | None = None              # пропорция вдоль родителя (0..1)
    anchor_xy: list | None = None            # абсолютная позиция якоря [x, y]
    x: float | None = None
    y: float | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}

    @classmethod
    def from_dict(cls, d: dict) -> "ConnectionEnd":
        return cls(
            kind=d["kind"],
            component_id=d.get("component_id"),
            terminal_id=d.get("terminal_id"),
            connection_id=d.get("connection_id"),
            anchor=d.get("anchor"),
            anchor_xy=d.get("anchor_xy"),
            x=d.get("x"),
            y=d.get("y"),
        )


@dataclass
class Connection:
    id: str
    ends: tuple[ConnectionEnd, ConnectionEnd]
    waypoints: list[list[float]] = field(default_factory=list)
    color: str = "#222"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ends": [e.to_dict() for e in self.ends],
            "waypoints": [list(w) for w in self.waypoints],
            "color": self.color,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Connection":
        ends = tuple(ConnectionEnd.from_dict(e) for e in d["ends"])
        if len(ends) != 2:
            raise ValueError("Connection must have exactly 2 ends")
        return cls(
            id=d["id"], ends=ends,   # type: ignore[arg-type]
            waypoints=[list(w) for w in d.get("waypoints", [])],
            color=d.get("color", "#222"),
        )


@dataclass
class Project:
    schema_version: int = 1
    id: str = field(default_factory=lambda: uuid4().hex)
    name: str = "Новый проект"
    created: str = field(default_factory=_now)
    modified: str = ""
    viewport: dict = field(default_factory=lambda: {"x": 0, "y": 0, "zoom": 1})
    components: list[ComponentInstance] = field(default_factory=list)
    connections: list[Connection] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "id": self.id,
            "name": self.name,
            "created": self.created,
            "modified": self.modified or self.created,
            "viewport": self.viewport,
            "components": [c.to_dict() for c in self.components],
            "connections": [c.to_dict() for c in self.connections],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Project":
        v = int(d.get("schema_version", 1))
        if v > 1:
            raise ValueError(f"Project schema_version {v} is not supported")
        return cls(
            schema_version=v,
            id=d["id"],
            name=d.get("name", "Без имени"),
            created=d.get("created", _now()),
            modified=d.get("modified", ""),
            viewport=d.get("viewport", {"x": 0, "y": 0, "zoom": 1}),
            components=[ComponentInstance.from_dict(c) for c in d.get("components", [])],
            connections=[Connection.from_dict(c) for c in d.get("connections", [])],
        )