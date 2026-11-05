# Start file for the hosting server (gunicorn).
#
# The folder "app" and the file "app.py" share a name, so the server
# uses this file instead:  gunicorn wsgi:app

from app import create_app

app = create_app()