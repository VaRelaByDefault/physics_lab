from flask import Blueprint, jsonify
from backend.registry import get_registry

bp = Blueprint("catalog", __name__)

@bp.get("/catalog")
def catalog():
    reg = get_registry()
    return jsonify({"version": reg.version, "items": reg.items()})