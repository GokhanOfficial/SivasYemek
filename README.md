# Sivas Yemek

Sivas'taki üç yemekhanenin günlük menüsünü tek sayfada gösterir:

| Kaynak | Öğünler | Nasıl alınıyor |
|---|---|---|
| [kykyemek.com](https://kykyemek.com) (KYK Sivas) | Kahvaltı, akşam | Ana sayfa `city=Sivas` ve `mealType` çerezleriyle istenir, kartlar ayrıştırılır |
| [CÜ Öğrenci Yemekhanesi](https://www.cumhuriyet.edu.tr/yemeklistesi/index.php) | Öğle | Aylık liste HTML'den ayrıştırılır |
| [CÜTF Hastane Yemekhanesi](https://hastaneler.cumhuriyet.edu.tr/index.php?cubid=194) | Öğle (hasta-personel), akşam (personel) | Sayfadaki `.docx` aylık liste indirilip tablosu okunur |

## Güncelleme mantığı

- Her kaynak **24 saatte bir** güncellenir.
- Bir kaynak hata verirse (site kapalı, yapı değişmiş, boş liste…) **o kaynak 1 saat sonra** yeniden denenir. Bu, başarılı olana kadar saatte bir tekrarlanır.
- Hata sırasında o kaynağın **son başarılı verisi gösterilmeye devam eder**. Sayfanın altında hangi kaynağın ne zaman güncellendiği ve sıradaki denemenin ne zaman yapılacağı yazar.
- Durum `DATA_DIR/state.json` dosyasında saklanır. Sunucu yeniden başlatıldığında gereksiz yere kazıma yapılmaz, plan kaldığı yerden devam eder.

Python standart kütüphanesi dışında hiçbir bağımlılık yoktur (Python 3.10+).

## Çalıştırma

### Docker (önerilen)

```bash
docker compose up -d --build
docker compose logs -f
```

Site `http://SUNUCU:8080` adresinde açılır. Veriler proje klasöründeki `./data` klasöründe (`state.json`) tutulur. Klasör yoksa otomatik oluşturulur. Konteyner başlarken klasörün sahipliğini kendi kullanıcısına (UID 10001) verir; bu yüzden sunucuda klasörün kime ait olduğu önemli değildir.

### Docker'sız (systemd)

`deploy/sivas-yemek.service` dosyasının başındaki kurulum adımlarını izleyin.

### Elle

```bash
python3 server.py            # sunucu + zamanlayıcı
python3 server.py --once     # tüm kaynakları bir kez çek ve çık (test için)
```

## Ayarlar

| Ortam değişkeni | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `8080` | Dinlenecek port |
| `HOST` | `0.0.0.0` | Dinlenecek adres (ters vekil arkasında `127.0.0.1`) |
| `DATA_DIR` | `./data` | Durum dosyasının klasörü |
| `UPDATE_INTERVAL_HOURS` | `24` | Başarılı güncellemeler arası süre |
| `RETRY_INTERVAL_HOURS` | `1` | Hatadan sonra yeniden deneme süresi |

## Alan adı ve HTTPS

Uygulamayı bir ters vekilin arkasına koyun. Caddy örneği (`/etc/caddy/Caddyfile`):

```
yemek.ornek.com {
    reverse_proxy 127.0.0.1:8080
}
```

Nginx için `proxy_pass http://127.0.0.1:8080;` yeterlidir.

## Uç noktalar

- `/` — site
- `/api/menus.json` — tüm kaynakların verisi ve durumu
- `/healthz` — sağlık kontrolü

## Bilinen sınırlar

- KYK ana sayfası yalnızca içinde bulunulan ayı gösterir. Bu yüzden ayın son günü ertesi günün KYK menüsü görünmeyebilir.
- Hastane listesi Word dosyası olarak yayınlanıyor. Dosya biçimi PDF'e ya da resme dönerse ayrıştırıcı hata verir. Bu durumda son veri gösterilmeye devam eder ve saatte bir yeniden denenir.
- Kaynak sitelerin yapısı değişirse ilgili fonksiyonun (`scrapers.py`) güncellenmesi gerekir. Loglarda `başarısız` satırını arayın.
