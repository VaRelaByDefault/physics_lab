import mimetypes

# ВАЖНО: только для Python < 3.13 актуально на Windows.
# Регистрируем MIME-типы до импорта Flask, чтобы он подхватил их в static.
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/javascript",        ".mjs")
mimetypes.add_type("text/css",               ".css")
mimetypes.add_type("image/svg+xml",          ".svg")
mimetypes.add_type("application/json",       ".json")
mimetypes.add_type("image/x-icon",           ".ico")

from flask import Flask
from .api import register_api
from .web import bp as web_bp


def create_app() -> Flask:
    app = Flask(__name__, static_folder="../static", template_folder="../templates")
    register_api(app)
    app.register_blueprint(web_bp)
    return app