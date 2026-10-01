from __future__ import annotations
from .base import BaseComponent


class ToggleSwitch(BaseComponent):
    def is_closed(self) -> bool:
        return bool(self.state.get("closed", False))


class PushButton(BaseComponent):
    def is_closed(self) -> bool:
        return bool(self.state.get("pressed", False))