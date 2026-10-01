from .projects import bp as projects_bp
from .catalog import bp as catalog_bp
from .simulate import bp as simulate_bp


def register_api(app):
    app.register_blueprint(catalog_bp,  url_prefix="/api")
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(simulate_bp, url_prefix="/api")