FROM python:3.12-slim

# ffmpeg and ffprobe are used to make the 360p / 720p / 1080p copies.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV FLASK_APP=wsgi.py
ENV PYTHONUNBUFFERED=1

# Create or update the database tables, then start the server.
# One worker with many threads keeps chat (Socket.IO) working.
CMD ["sh", "-c", "flask db upgrade && gunicorn --worker-class gthread --threads 100 --workers 1 --timeout 300 --bind 0.0.0.0:${PORT:-10000} wsgi:app"]