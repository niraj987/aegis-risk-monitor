# Build context: repository root (see docker-compose.yml).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    RISK_DATA_DIR=/data \
    DATABASE_PATH=/data/risk_monitor.sqlite3

WORKDIR /app

RUN groupadd --system aegis \
    && useradd --system --gid aegis --home-dir /app aegis

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app

RUN mkdir -p /data && chown -R aegis:aegis /app /data

USER aegis
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=6s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"

# One long-running API + scheduler container. For a single containerized run:
#   docker compose run --rm monitor-once
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
