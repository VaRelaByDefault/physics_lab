from flask import Blueprint, jsonify, request
from backend.models.project import Project
from backend.models.validation import validate_project, ValidationError
from backend.registry import get_registry
from backend.simulation.solver import solve

bp = Blueprint("simulate", __name__)


@bp.post("/simulate")
def simulate():
    data = request.get_json(force=True) or {}
    try:
        project = Project.from_dict(data)
    except Exception as e:
        return jsonify({"errors": [str(e)]}), 400

    reg = get_registry()
    try:
        validate_project(project, reg)
    except ValidationError as e:
        return jsonify({"errors": e.errors}), 400

    warnings = []
    for c in project.components:
        spec = reg.get(c.type)
        if not spec.get("simulatable", True):
            warnings.append(f"{c.id}: {spec['label']} не симулируется (уровень A)")

    try:
        result = solve(project, reg)
    except Exception as e:
        return jsonify({"errors": [f"Ошибка расчёта: {e}"]}), 500

    payload = result.to_dict()
    payload["warnings"] = warnings + payload.get("warnings", [])
    return jsonify(payload)