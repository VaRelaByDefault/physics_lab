from __future__ import annotations
from .base import BaseComponent


class DCVoltageSource(BaseComponent):
    def voltage(self) -> float:
        return float(self.props.get("voltage", 12.0))

    def is_on(self) -> bool:
        return bool(self.state.get("on", True))


class DCCurrentSource(BaseComponent):
    def current(self) -> float:
        return float(self.props.get("current", 1.0))

    def is_on(self) -> bool:
        return bool(self.state.get("on", True))


class ACVoltageSource(BaseComponent):
    def voltage(self):
        return None

    def is_on(self) -> bool:
        return bool(self.state.get("on", True))