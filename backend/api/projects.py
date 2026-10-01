from flask import Blueprint, jsonify, request, abort
from backend.models.project import Project
from backend.models.validation import validate_project, ValidationError
from backend.registry import get_registry
from backend.storage import project_io

bp = Blueprint("projects", __name__)


@bp.get("")
def list_():
    return jsonify(project_io.list_projects())


@bp.post("")
def create():
    data = request.get_json(force=True) or {}
    project = Project(name=data.get("name", "Новый проект"))
    try:
        validate_project(project, get_registry())
    except ValidationError as e:
        return jsonify({"errors": e.errors}), 400
    project_io.save_project(project)
    return jsonify(project.to_dict()), 201


@bp.get("/<project_id>")
def get(project_id: str):
    try:
        return jsonify(project_io.load_project(project_id).to_dict())
    except FileNotFoundError:
        abort(404)


@bp.put("/<project_id>")
def put(project_id: str):
    data = request.get_json(force=True) or {}
    data["id"] = project_id
    try:
        project = Project.from_dict(data)
    except Exception as e:
        return jsonify({"errors": [str(e)]}), 400
    try:
        validate_project(project, get_registry())
    except ValidationError as e:
        return jsonify({"errors": e.errors}), 400
    project_io.save_project(project)
    return jsonify(project.to_dict())


@bp.delete("/<project_id>")
def delete(project_id: str):
    project_io.delete_project(project_id)
    return ("", 204)