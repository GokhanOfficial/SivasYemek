FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    PORT=8080

WORKDIR /app
COPY scrapers.py server.py ./
COPY public ./public
COPY deploy/entrypoint.sh /entrypoint.sh

RUN useradd --system --uid 10001 --no-create-home app \
    && mkdir -p /data \
    && chmod +x /entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=1m --timeout=5s CMD python -c "import urllib.request,os;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz',timeout=4)"

# entrypoint.sh /data sahipliğini düzeltir, sonra root olmayan "app" kullanıcısına geçer.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "server.py"]
