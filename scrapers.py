"""Sivas yemekhane kaynaklarından menü toplayan kazıyıcılar.

Yalnızca Python standart kütüphanesi kullanılır. Her kazıyıcı şu biçimde
kayıtlardan oluşan bir liste döndürür:

    {"date": "2026-11-23", "meal": "kahvalti" | "ogle" | "aksam",
     "items": ["Mercimek Çorbası", ...], "notes": [...], "calories": "650-850 kcal" | None}
"""

from __future__ import annotations

import html
import io
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, datetime, timedelta, timezone

TR_TZ = timezone(timedelta(hours=3), "Europe/Istanbul")  # Türkiye 2016'dan beri sabit UTC+3
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0 Safari/537.36 SivasYemek/1.0"
)
TIMEOUT = 30
MAX_BYTES = 20 * 1024 * 1024

KYK_URL = "https://kykyemek.com/"
CU_URL = "https://www.cumhuriyet.edu.tr/yemeklistesi/index.php"
HASTANE_URL = "https://hastaneler.cumhuriyet.edu.tr/index.php?cubid=194"

TR_MONTHS = {
    "ocak": 1, "şubat": 2, "mart": 3, "nisan": 4, "mayıs": 5, "haziran": 6,
    "temmuz": 7, "ağustos": 8, "eylül": 9, "ekim": 10, "kasım": 11, "aralık": 12,
}


class ScrapeError(Exception):
    """Kaynak sayfa beklenen biçimde değilse fırlatılır."""


# --------------------------------------------------------------------------- yardımcılar

def today_tr() -> date:
    return datetime.now(TR_TZ).date()


def fetch(url: str, cookies: dict[str, str] | None = None) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept-Language": "tr-TR,tr;q=0.9",
    })
    if cookies:
        req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()))
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # HTTP hatalarında HTTPError fırlatır
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ScrapeError(f"Yanıt çok büyük: {url}")
    return data


def tr_lower(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def tr_upper(s: str) -> str:
    return s.replace("i", "İ").replace("ı", "I").upper()


def tr_title(s: str) -> str:
    return re.sub(r"[^\W\d_]+", lambda m: tr_upper(m.group()[0]) + m.group()[1:], tr_lower(s))


def strip_tags(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s)


def norm_item(s: str) -> str:
    """Boşlukları toparlar, '/' ile ayrılmış alternatifleri düzenler, TAMAMI BÜYÜK harfse başlık biçimine çevirir."""
    s = re.sub(r"\s+", " ", s.replace(" ", " ")).strip()
    parts = [p.strip() for p in s.split("/")]
    s = " / ".join(p for p in parts if p)
    if s and any(c.isalpha() for c in s) and s == tr_upper(s):
        s = tr_title(s)
    return s


# --------------------------------------------------------------------------- KYK

def _kyk_date(text: str) -> date | None:
    m = re.search(r"(\d{1,2})\s+([^\s\d]+)\s+(\d{4})", text)
    if not m:
        return None
    month = TR_MONTHS.get(tr_lower(m.group(2)))
    if not month:
        return None
    return date(int(m.group(3)), month, int(m.group(1)))


def _kyk_main_text(inner: str) -> str:
    inner = re.sub(r"<span[^>]*slash-separator[^>]*>.*?</span>", " / ", inner, flags=re.S)
    inner = re.sub(r"<span[^>]*food-detail-text[^>]*>(.*?)</span>", r" \1", inner, flags=re.S)
    return norm_item(strip_tags(inner))


def parse_kyk(page: str, meal: str) -> list[dict]:
    title = re.search(r'id="menuTitle"[^>]*>(.*?)</h3>', page, re.S)
    if not title or "sivas" not in tr_lower(strip_tags(title.group(1))):
        raise ScrapeError("KYK sayfası Sivas menüsünü göstermedi (şehir çerezi yok sayılmış olabilir)")

    entries = []
    for card in re.split(r"""<div class=['"]card cardStyle""", page)[1:]:
        dm = re.search(r'class="[^"]*cardDate[^"]*"[^>]*>(.*?)</p>', card, re.S)
        if not dm:
            continue
        day = _kyk_date(strip_tags(dm.group(1)))
        if not day:
            continue
        body = card.split("cardFooter", 1)[0]
        kcal = re.search(r"(\d[\d\s\-–]*kcal)", strip_tags(body))
        body = body.split("<!--Kalori", 1)[0]

        items, notes = [], []
        for pm in re.finditer(r'<p class="([^"]*)"[^>]*>(.*?)</p>', body, re.S):
            cls, inner = pm.group(1).split(), pm.group(2)
            if "underline" in cls or "cardDate" in cls:  # "Al Götür Menü" bağlantısı / tarih
                continue
            if "food-detail-text" in cls:
                text = norm_item(strip_tags(inner))
                if text:
                    notes.append(text)
            elif "food-main-text" in cls:
                text = _kyk_main_text(inner)
                if text and "kcal" not in text:
                    items.append(text)
        if items:
            entries.append({
                "date": day.isoformat(), "meal": meal, "items": items, "notes": notes,
                "calories": re.sub(r"\s+", " ", kcal.group(1)).strip() if kcal else None,
            })
    return entries


def scrape_kyk() -> list[dict]:
    entries = []
    for meal, meal_flag in (("kahvalti", "false"), ("aksam", "true")):
        page = fetch(KYK_URL, cookies={"city": "Sivas", "mealType": meal_flag}).decode("utf-8", "replace")
        found = parse_kyk(page, meal)
        if not found:
            raise ScrapeError(f"KYK {meal} listesinde hiç gün bulunamadı")
        entries += found
    return entries


# --------------------------------------------------------------------------- CÜ Öğrenci Yemekhanesi

def parse_cu(page: str) -> list[dict]:
    start = page.find('id="ylistTable"')
    if start < 0:
        raise ScrapeError("CÜ sayfasında yemek tablosu (ylistTable) bulunamadı")
    page = page[start:]

    entries = []
    for m in re.finditer(r"<h4[^>]*>(.*?)</h4>(.*?)</div>", page, re.S):
        label = strip_tags(m.group(1)).strip()
        dm = re.match(r"(\d{1,2})[-./](\d{1,2})[-./](\d{4})", label)
        if dm:
            day = date(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)))
        elif tr_upper(label) == "BUGÜN":
            day = today_tr()
        else:
            continue
        content = m.group(2)
        note_m = re.search(r"<small[^>]*>(.*?)</small>", content, re.S)
        content = re.sub(r"<small[^>]*>.*?</small>", "", content, flags=re.S)
        items = [norm_item(strip_tags(x)) for x in re.split(r"<br\s*/?>", content, flags=re.I)]
        items = [x for x in items if x]
        note = norm_item(strip_tags(note_m.group(1))) if note_m else ""
        if items:
            entries.append({
                "date": day.isoformat(), "meal": "ogle", "items": items,
                "notes": [note] if note else [], "calories": None,
            })
    return entries


def scrape_cu() -> list[dict]:
    return parse_cu(fetch(CU_URL).decode("utf-8", "replace"))


# --------------------------------------------------------------------------- CÜTF Hastane Yemekhanesi

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _cell_lines(tc: ET.Element) -> list[str]:
    lines = []
    for p in tc.iter(W + "p"):
        buf = []
        for el in p.iter():
            if el.tag == W + "t" and el.text:
                buf.append(el.text)
            elif el.tag in (W + "br", W + "cr"):
                buf.append("\n")
            elif el.tag == W + "tab":
                buf.append(" ")
        lines += "".join(buf).split("\n")
    return [x for x in (norm_item(line) for line in lines) if x]


def parse_hastane_docx(data: bytes) -> list[dict]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise ScrapeError(f"Hastane menü dosyası okunamadı: {e}") from e

    entries = {}
    for tbl in root.iter(W + "tbl"):
        col_map: dict[int, str] | None = None
        for tr in tbl.findall(W + "tr"):
            cells = [_cell_lines(tc) for tc in tr.findall(W + "tc")]
            if not cells:
                continue
            joined = [tr_upper(" ".join(c)) for c in cells]
            if col_map is None and any("ÖĞLE" in t or "AKŞAM" in t for t in joined):
                col_map = {}
                for i, t in enumerate(joined):
                    if "ÖĞLE" in t:
                        col_map[i] = "ogle"
                    elif "AKŞAM" in t:
                        col_map[i] = "aksam"
                continue
            dm = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", " ".join(cells[0]))
            if not dm:
                continue
            day = date(int(dm.group(3)), int(dm.group(2)), int(dm.group(1)))
            for i, meal in (col_map or {1: "ogle", 2: "aksam"}).items():
                if i < len(cells) and cells[i]:
                    entries[(day, meal)] = {
                        "date": day.isoformat(), "meal": meal, "items": cells[i],
                        "notes": [], "calories": None,
                    }
    return list(entries.values())


def scrape_hastane() -> list[dict]:
    page = fetch(HASTANE_URL).decode("utf-8", "replace")
    links = re.findall(r'href="([^"]+\.docx)"', page, re.I)
    if not links:
        raise ScrapeError("Hastane sayfasında .docx yemek listesi bağlantısı bulunamadı")
    merged: dict[tuple, dict] = {}
    for link in dict.fromkeys(links):  # sırayı koruyarak tekrarları at
        url = urllib.parse.urljoin(HASTANE_URL, html.unescape(link))
        for e in parse_hastane_docx(fetch(url)):
            merged[(e["date"], e["meal"])] = e
    return sorted(merged.values(), key=lambda e: (e["date"], e["meal"]))


# --------------------------------------------------------------------------- kaynak listesi

SOURCES = {
    "kyk": {
        "name": "KYK Sivas yurtları",
        "url": "https://kykyemek.com",
        "meal_labels": {},
        "scrape": scrape_kyk,
    },
    "cu": {
        "name": "CÜ öğrenci yemekhanesi",
        "url": CU_URL,
        "meal_labels": {},
        "scrape": scrape_cu,
    },
    "hastane": {
        "name": "CÜTF hastane yemekhanesi",
        "url": HASTANE_URL,
        "meal_labels": {"ogle": "Hasta ve personel", "aksam": "Personel"},
        "scrape": scrape_hastane,
    },
}
