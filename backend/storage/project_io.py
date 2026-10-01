from __future__ import annotations
import json
import os
import tempfile
from pathlib import Path

from backend.models.project import Project

PROJECTS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _path(project_id: str) -> Path:
    if "/" in project_id or "\\" in project_id or project_id.startswith("."):
        raise ValueError("Invalid project id")
    return PROJECTS_DIR / f"{project_id}.json"


def list_projects() -> list[dict]:
    result = []
    for p in PROJECTS_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text("utf-8"))
        except Exception:
            continue
        result.append({
            "id": d.get("id", p.stem),
            "name": d.get("name", p.stem),
            "modified": d.get("modified") or d.get("created", ""),
        })
    result.sort(key=lambda x: x["modified"], reverse=True)
    return result


def load_project(project_id: str) -> Project:
    p = _path(project_id)
    if not p.exists():
        raise FileNotFoundError(project_id)
    return Project.from_dict(json.loads(p.read_text("utf-8")))


def save_project(project: Project) -> Project:
    from datetime import datetime, timezone
    project.modified = datetime.now(timezone.utc).isoformat()
    data = project.to_dict()
    p = _path(project.id)

    with tempfile.NamedTemporaryFile(
        "w", dir=PROJECTS_DIR, delete=False, encoding="utf-8", suffix=".tmp"
    ) as tmp:
        json.dump(data, tmp, ensure_ascii=False, indent=2)
        tmp_name = tmp.name
    os.replace(tmp_name, p)
    return project


def delete_project(project_id: str) -> None:
    _path(project_id).unlink(missing_ok=True)