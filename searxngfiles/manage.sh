#!/usr/bin/env bash
# =============================================================================
# SearXNG Deep Search — Kurulum & Yönetim Scripti
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Renk tanımları
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*" >&2; }
info()  { echo -e "${CYAN}[i]${NC} $*"; }

# =============================================================================
# KOMUTLAR
# =============================================================================

cmd_install() {
    log "SearXNG Deep Search kurulumu başlıyor..."

    # Docker kontrolü
    if ! command -v docker &> /dev/null; then
        err "Docker kurulu değil. Lütfen Docker'ı kurun: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
        err "Docker Compose kurulu değil."
        exit 1
    fi

    # .env oluştur
    if [ ! -f .env ]; then
        log ".env dosyası oluşturuluyor..."
        SECRET=$(openssl rand -hex 32 2>/dev/null || python3 -c "import secrets; print(secrets.token_hex(32))")
        sed "s/your-super-secret-key-change-this/$SECRET/" .env.example > .env 2>/dev/null || \
        cat > .env << EOF
SEARXNG_PORT=8888
SEARXNG_BASE_URL=http://localhost:8888
SEARXNG_SECRET=$SECRET
SEARXNG_HOSTNAME=search.example.com
DEEPSEARCH_MAX_RESULTS=50
DEEPSEARCH_TIMEOUT=30
DEEPSEARCH_CONCURRENT_CATEGORIES=5
DEEPSEARCH_CACHE_TTL=3600
EOF
        log "Secret key oluşturuldu."
    else
        warn ".env dosyası zaten mevcut, atlanıyor."
    fi

    # Python ortamı
    if command -v python3 &> /dev/null && [ -f requirements.txt ]; then
        log "Python bağımlılıkları kuruluyor..."
        python3 -m pip install -r requirements.txt --quiet 2>/dev/null || \
            warn "Python bağımlılıkları kurulamadı (opsiyonel)"
    fi

    # Docker imajları
    log "Docker imajları çekiliyor..."
    docker compose pull

    log "Kurulum tamamlandı! 'manage.sh start' ile başlatın."
}

cmd_start() {
    log "SearXNG Deep Search başlatılıyor..."
    docker compose up -d

    # Sağlık kontrolü bekle
    info "Servisler hazırlanıyor..."
    local retries=30
    while [ $retries -gt 0 ]; do
        if curl -sf "http://localhost:${SEARXNG_PORT:-8888}/search?q=test&format=json" > /dev/null 2>&1; then
            log "SearXNG hazır! → http://localhost:${SEARXNG_PORT:-8888}"
            return 0
        fi
        retries=$((retries - 1))
        sleep 2
    done
    warn "SearXNG henüz yanıt vermiyor, logları kontrol edin: manage.sh logs"
}

cmd_stop() {
    log "SearXNG durduruluyor..."
    docker compose down
    log "Durduruldu."
}

cmd_restart() {
    cmd_stop
    cmd_start
}

cmd_status() {
    echo -e "\n${CYAN}═══ Container Durumu ═══${NC}"
    docker compose ps

    echo -e "\n${CYAN}═══ Sağlık Kontrolü ═══${NC}"

    # SearXNG
    local port="${SEARXNG_PORT:-8888}"
    if curl -sf "http://localhost:$port/search?q=test&format=json" > /dev/null 2>&1; then
        local result_count
        result_count=$(curl -sf "http://localhost:$port/search?q=test&format=json" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "?")
        log "SearXNG: ✅ Çalışıyor (${result_count} sonuç)"
    else
        err "SearXNG: ❌ Yanıt yok"
    fi

    # Redis
    if docker exec searxng-redis redis-cli ping 2>/dev/null | grep -q PONG; then
        local mem
        mem=$(docker exec searxng-redis redis-cli info memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '[:space:]')
        log "Redis:   ✅ Çalışıyor (Bellek: ${mem})"
    else
        err "Redis:   ❌ Bağlantı yok"
    fi

    echo -e "\n${CYAN}═══ Kaynak Kullanımı ═══${NC}"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" \
        $(docker compose ps -q 2>/dev/null) 2>/dev/null || true
}

cmd_logs() {
    local service="${1:-}"
    if [ -n "$service" ]; then
        docker compose logs -f "$service"
    else
        docker compose logs -f
    fi
}

cmd_test() {
    info "Arama testi yapılıyor..."
    local port="${SEARXNG_PORT:-8888}"

    # API testi
    echo -e "\n${CYAN}── JSON API Testi ──${NC}"
    local response
    response=$(curl -sf "http://localhost:$port/search?q=artificial+intelligence&format=json&categories=general" 2>/dev/null)
    if [ -n "$response" ]; then
        echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('results', [])
engines = set()
for r in results:
    engines.update(r.get('engines', []))
print(f'  Sonuç sayısı: {len(results)}')
print(f'  Aktif motorlar: {len(engines)}')
print(f'  Motorlar: {\", \".join(sorted(engines)[:15])}')
if len(engines) > 15:
    print(f'  ... ve {len(engines)-15} motor daha')
" 2>/dev/null || err "Parse hatası"
    else
        err "API yanıt vermedi"
    fi

    # Kategori testi
    echo -e "\n${CYAN}── Kategori Testleri ──${NC}"
    for cat in general news science it; do
        local count
        count=$(curl -sf "http://localhost:$port/search?q=test&format=json&categories=$cat" 2>/dev/null | \
            python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")
        if [ "$count" -gt 0 ] 2>/dev/null; then
            log "$cat: $count sonuç"
        else
            warn "$cat: sonuç yok"
        fi
    done

    # Python CLI testi
    if command -v python3 &> /dev/null && python3 -c "import deepsearch" 2>/dev/null; then
        echo -e "\n${CYAN}── Python CLI Testi ──${NC}"
        python3 cli.py health
    fi

    echo -e "\n${GREEN}Test tamamlandı.${NC}"
}

cmd_update() {
    log "İmajlar güncelleniyor..."
    docker compose pull
    docker compose up -d
    log "Güncelleme tamamlandı."
}

cmd_reset() {
    warn "Tüm veriler silinecek (cache, volumes). Emin misiniz? (y/N)"
    read -r confirm
    if [[ "$confirm" =~ ^[yY]$ ]]; then
        docker compose down -v
        log "Tüm veriler silindi."
    else
        info "İptal edildi."
    fi
}

cmd_help() {
    cat << 'EOF'

╔══════════════════════════════════════════════════════════════╗
║           SearXNG Deep Search — Yönetim Aracı               ║
╚══════════════════════════════════════════════════════════════╝

Kullanım: ./manage.sh <komut> [argümanlar]

  install    İlk kurulum (Docker pull, .env oluştur, pip install)
  start      Servisleri başlat
  stop       Servisleri durdur
  restart    Yeniden başlat
  status     Durum ve sağlık kontrolü
  logs       Container logları (opsiyonel: service adı)
  test       Kapsamlı API ve motor testi
  update     Docker imajlarını güncelle
  reset      Tüm verileri sil ve sıfırla
  help       Bu yardım mesajı

Örnekler:
  ./manage.sh install         # İlk kurulum
  ./manage.sh start           # Başlat
  ./manage.sh test            # Test et
  ./manage.sh logs searxng    # SearXNG logları

EOF
}

# =============================================================================
# MAIN
# =============================================================================

# .env yükle
[ -f .env ] && source .env 2>/dev/null || true

case "${1:-help}" in
    install)  cmd_install ;;
    start)    cmd_start ;;
    stop)     cmd_stop ;;
    restart)  cmd_restart ;;
    status)   cmd_status ;;
    logs)     cmd_logs "${2:-}" ;;
    test)     cmd_test ;;
    update)   cmd_update ;;
    reset)    cmd_reset ;;
    help|*)   cmd_help ;;
esac
