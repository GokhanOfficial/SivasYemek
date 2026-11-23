#!/bin/sh
# ./data klasörü sunucuda kime ait olursa olsun yazılabilir olsun diye
# sahipliği "app" kullanıcısına verir, ardından root yetkisini bırakır.
set -e
if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DATA_DIR"
    chown -R app:app "$DATA_DIR"
    exec setpriv --reuid=app --regid=app --init-groups "$@"
fi
exec "$@"
