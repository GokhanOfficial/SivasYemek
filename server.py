"""Sivas Yemek sunucusu.

- Her kaynağı 24 saatte bir günceller; bir kaynak hata verirse o kaynağı 1 saat
  aralıklarla yeniden dener (son başarılı veri gösterilmeye devam eder).
- public/ klasörünü ve /api/menus.json uç noktasını sunar.

Ayarlar (ortam değişkenleri):
    HOST (0.0.0.0), PORT (8080), DATA_DIR (./data),
    UPDATE_INTERVAL_HOURS (24), RETRY_INTERVAL_HOURS (1)

Kullanım:
    python server.py          # sunucu + zamanlayıcı
    python server.py --once   # tüm kaynakları bir kez güncelle ve çık
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scrapers import SOURCES, TR_TZ, ScrapeError

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
STATE_FILE = DATA_DIR / "state.json"

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))
UPDATE_INTERVAL = float(os.environ.get("UPDATE_INTERVAL_HOURS", "24")) * 3600
RETRY_INTERVAL = float(os.environ.get("RETRY_INTERVAL_HOURS", "1")) * 3600

log = logging.getLogger("sivas-yemek")


def iso(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts, TR_TZ).isoformat(timespec="seconds") if ts else None


class Updater:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.state = self._load()
        self.api_bytes = b""
        self._render_api()

    # ------------------------------------------------------------ kalıcı durum
    def _load(self) -> dict:
        state = {}
        if STATE_FILE.exists():
            try:
                state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                log.exception("Durum dosyası okunamadı, sıfırdan başlanıyor")
        for sid in SOURCES:
            state.setdefault(sid, {"entries": [], "next_run": 0})
        return state

    def _save(self) -> None:
        # Yazılamazsa zamanlayıcı durmasın; veri bellekte sunulmaya devam eder.
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = STATE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, STATE_FILE)
        except OSError as e:
            log.error("Durum dosyası yazılamadı (%s): %s", STATE_FILE, e)

    def _render_api(self) -> None:
        payload = {
            "generated_at": iso(time.time()),
            "sources": [
                {
                    "id": sid,
                    "name": src["name"],
                    "url": src["url"],
                    "meal_labels": src["meal_labels"],
                    "ok": st.get("ok"),
                    "last_success": iso(st.get("last_success")),
                    "last_attempt": iso(st.get("last_attempt")),
                    "next_run": iso(st.get("next_run")),
                    "error": st.get("last_error"),
                    "entries": st.get("entries", []),
                }
                for sid, src in SOURCES.items()
                for st in [self.state[sid]]
            ],
        }
        self.api_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    # ------------------------------------------------------------ güncelleme
    def run_source(self, sid: str) -> bool:
        log.info("%s güncelleniyor…", sid)
        started = time.time()
        try:
            entries = SOURCES[sid]["scrape"]()
            if not entries:
                raise ScrapeError("Hiç menü bulunamadı")
            ok, error = True, None
        except Exception as e:  # ağ, HTTP, ayrıştırma… hepsi yeniden denenir
            log.warning("%s başarısız: %s: %s", sid, type(e).__name__, e)
            ok, error, entries = False, f"{type(e).__name__}: {e}"[:300], None

        with self.lock:
            st = self.state[sid]
            st["ok"] = ok
            st["last_attempt"] = started
            st["last_error"] = error
            if ok:
                st["entries"] = entries
                st["last_success"] = started
                st["next_run"] = started + UPDATE_INTERVAL
                log.info("%s tamam: %d kayıt, sonraki güncelleme %s", sid, len(entries), iso(st["next_run"]))
            else:
                st["next_run"] = started + RETRY_INTERVAL
                log.info("%s yeniden denenecek: %s", sid, iso(st["next_run"]))
            self._save()
            self._render_api()
        return ok

    def run_due(self) -> None:
        now = time.time()
        for sid in SOURCES:
            if self.state[sid].get("next_run", 0) <= now and not self.stop.is_set():
                self.run_source(sid)

    def loop(self) -> None:
        while not self.stop.is_set():
            self.run_due()
            next_ts = min(self.state[sid].get("next_run", 0) for sid in SOURCES)
            # En fazla 10 dk uyu; saat değişiklikleri/uyku modundan sonra kayma olmasın.
            self.stop.wait(max(1.0, min(next_ts - time.time(), 600)))


def make_handler(updater: Updater):
    class Handler(SimpleHTTPRequestHandler):
        server_version = "SivasYemek/1.0"
        sys_version = ""

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/api/menus.json":
                return self._send(updater.api_bytes, "application/json; charset=utf-8", "no-cache")
            if path == "/healthz":
                return self._send(b'{"ok":true}', "application/json", "no-store")
            return super().do_GET()

        def do_HEAD(self) -> None:
            if self.path.split("?", 1)[0] in ("/api/menus.json", "/healthz"):
                self.send_response(200)
                self.end_headers()
                return
            super().do_HEAD()

        def _send(self, body: bytes, ctype: str, cache: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(body)

        def end_headers(self) -> None:
            self.send_header("X-Content-Type-Options", "nosniff")
            if not self.path.startswith(("/api/", "/healthz")):
                self.send_header("Cache-Control", "public, max-age=300")
            super().end_headers()

        def list_directory(self, path):  # klasör listelemeyi kapat
            self.send_error(404)
            return None

        def log_message(self, fmt, *args) -> None:
            log.debug("%s %s", self.address_string(), fmt % args)

    return partial(Handler, directory=str(PUBLIC_DIR))


def main() -> None:
    logging.Formatter.converter = lambda *_: datetime.now(TR_TZ).timetuple()  # loglar Türkiye saatiyle
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    updater = Updater()

    if "--once" in sys.argv:
        results = [updater.run_source(sid) for sid in SOURCES]
        sys.exit(0 if all(results) else 1)

    threading.Thread(target=updater.loop, name="updater", daemon=True).start()
    httpd = ThreadingHTTPServer((HOST, PORT), make_handler(updater))
    log.info("http://%s:%d adresinde yayında", HOST, PORT)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        updater.stop.set()
        httpd.server_close()


if __name__ == "__main__":
    main()
