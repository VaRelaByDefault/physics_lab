from __future__ import annotations
from .base import BaseComponent


class Resistor(BaseComponent):
    def resistance(self) -> float:
        r = float(self.props.get("resistance", 100.0))
        return max(r, 1e-6)


class VariableResistor(BaseComponent):
    """Реостат. Текущее сопротивление берётся из state.current_resistance,
    зажатое в диапазон [0, номинал]."""
    def resistance(self) -> float:
        r_max = max(float(self.props.get("resistance", 100.0)), 1e-6)
        r_now = self.state.get("current_resistance")
        if r_now is None:
            r_now = r_max
        r_now = float(r_now)
        r_now = max(0.0, min(r_max, r_now))
        return max(r_now, 1e-6)


class Potentiometer(BaseComponent):
    """Трёхвыводной делитель: R_ab задаётся, w ∈ [0,1] — положение движка.
    Терминалы: a, w (движок), b.
    """
    def resistance(self):
        return None  # в решателе обрабатывается особо

    def parts(self) -> tuple[float, float]:
        r_total = max(float(self.props.get("resistance", 1000.0)), 1e-6)
        w = float(self.state.get("wiper", 0.5))
        w = min(max(w, 0.0), 1.0)
        return r_total * w, r_total * (1.0 - w)


class Lamp(BaseComponent):
    def resistance(self) -> float:
        p = float(self.props.get("power", 1.0))
        u = float(self.props.get("voltage_nominal", 12.0))
        if p <= 0 or u <= 0:
            return 1e-6
        return (u * u) / p


class Heater(BaseComponent):
    def resistance(self) -> float:
        p = float(self.props.get("power", 100.0))
        u = float(self.props.get("voltage_nominal", 220.0))
        if p <= 0 or u <= 0:
            return 1e-6
        return (u * u) / p