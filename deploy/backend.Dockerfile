FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 boardroom \
    && useradd --uid 10001 --gid 10001 --no-create-home boardroom \
    && mkdir -p /data/recordings /data/voice \
    && chown -R 10001:10001 /data \
    && chmod 700 /data/recordings /data/voice
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --requirement backend/requirements.txt
COPY backend/app/ ./backend/app/
COPY backend/__init__.py ./backend/__init__.py
COPY scenarios/ ./scenarios/
# Existing ElevenLabs adapter; no local inference models are bundled or changed.
COPY rehearsal/ ./rehearsal/
# Shared Vertex provider plus public participant material used by the current game.
COPY playtest/__init__.py playtest/vertex.py ./playtest/
COPY playtest/fixtures/participant-packs.json playtest/fixtures/recordings.json ./playtest/fixtures/
COPY playtest/recordings/manifest.json playtest/recordings/*.mp3 ./playtest/recordings/
COPY output/pdf/demo-t01-service-outage.pdf output/pdf/demo-t02-fundraising.pdf output/pdf/demo-t03-succession-payroll.pdf ./output/pdf/
COPY deploy/backend-entrypoint.sh /usr/local/bin/boardroom-entrypoint
RUN chmod 755 /usr/local/bin/boardroom-entrypoint
USER 10001:10001
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/boardroom-entrypoint"]
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--timeout-graceful-shutdown", "25"]
