from __future__ import annotations
from enum import Enum


class Direction(str, Enum):
    IN = "in"
    OUT = "out"
    INOUT = "inout"


class ElementKind(str, Enum):
    SOURCE_V = "source_v"
    SOURCE_I = "source_i"
    PASSIVE = "passive"
    SWITCH = "switch"
    INSTRUMENT = "instrument"


class BaseComponent:
    def __init__(self, properties: dict, state: dict):
        self.props = properties
        self.state = state

    def resistance(self) -> float | None:
        return None

    def voltage(self) -> float | None:
        return None

    def current(self) -> float | None:
        return None

    def is_closed(self) -> bool:
        return bool(self.state.get("closed") or self.state.get("pressed"))

    def is_on(self) -> bool:
        return bool(self.state.get("on", True))

    def measure(self, ctx) -> dict:
        return {}