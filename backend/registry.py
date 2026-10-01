import json
import importlib
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog.json"


class Registry:
    def __init__(self, path: Path = CATALOG_PATH):
        self._path = Path(path)
        self._catalog = json.loads(self._path.read_text("utf-8"))
        self._classes: dict[str, type] = {}

    @property
    def version(self) -> int:
        return self._catalog.get("version", 1)

    def items(self) -> dict:
        return self._catalog["items"]

    def get(self, type_name: str) -> dict:
        spec = self._catalog["items"].get(type_name)
        if spec is None:
            raise KeyError(f"Unknown component type: {type_name}")
        return spec

    def klass(self, type_name: str) -> type:
        if type_name not in self._classes:
            spec = self.get(type_name)
            module_path, _, cls_name = spec["class"].rpartition(".")
            module = importlib.import_module(module_path)
            self._classes[type_name] = getattr(module, cls_name)
        return self._classes[type_name]

    def create(self, type_name: str, properties: dict, state: dict):
        return self.klass(type_name)(properties or {}, state or {})


_registry: Registry | None = None


def get_registry() -> Registry:
    global _registry
    if _registry is None:
        _registry = Registry()
    return _registry