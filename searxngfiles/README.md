# SearXNG Deep Search Infrastructure

AI agent'lar ve LLM tabanlı uygulamalar için optimize edilmiş, container tabanlı kapsamlı web arama altyapısı.

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent / LLM App                       │
│         (OpenClaw, LangGraph, Claude Code, vb.)             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │  Python CLI   │  │ Agent Integ.   │  │  MCP Server    │  │
│  │  (cli.py)     │  │ (LangChain/    │  │  (stdio)       │  │
│  │               │  │  OpenAI/       │  │                │  │
│  │               │  │  Anthropic)    │  │                │  │
│  └──────┬───────┘  └───────┬────────┘  └───────┬────────┘  │
│         │                  │                    │           │
│         └──────────────────┼────────────────────┘           │
│                            │                                │
│                  ┌─────────▼──────────┐                     │
│                  │   deepsearch.py    │                     │
│                  │   (Core Engine)    │                     │
│                  │  • Paralel arama   │                     │
│                  │  • Sayfalama       │                     │
│                  │  • Deduplikasyon   │                     │
│                  │  • İçerik çekme    │                     │
│                  └─────────┬──────────┘                     │
├─────────────────────────────┼───────────────────────────────┤
│                    Docker   │  Network                      │
│  ┌─────────────────────────▼─────────────────────────────┐  │
│  │                   SearXNG                              │  │
│  │            (80+ Search Engine)                         │  │
│  │  Google · Bing · DuckDuckGo · Brave · Qwant ·         │  │
│  │  arXiv · Semantic Scholar · PubMed · GitHub ·          │  │
│  │  StackOverflow · Reddit · Wikipedia · YouTube · ...    │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                  │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │              Redis (Cache + Rate Limit)                │  │
│  │           allkeys-lru · 512MB · AOF persistence       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Caddy (Reverse Proxy — production)            │  │
│  │              Auto TLS · Rate Limiting                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Hızlı Başlangıç

```bash
# 1. Klonla / kopyala
cd searxng-deepsearch

# 2. Kur ve başlat
chmod +x manage.sh
./manage.sh install
./manage.sh start

# 3. Test et
./manage.sh test

# 4. Arama yap
curl "http://localhost:8888/search?q=test&format=json" | jq .
```

## CLI Kullanımı

```bash
# Basit arama
python cli.py search "LangGraph multi-agent architecture"

# Çoklu kategori + tam içerik çekme
python cli.py search "GraphRAG" --categories general it science --fetch

# Son bir haftanın haberleri
python cli.py search "yapay zeka Türkiye" --categories news --time-range week

# Belirli motorlarla arama
python cli.py search "Neo4j GraphRAG" --engines "google,github,arxiv"

# LLM prompt formatında çıktı
python cli.py search "NATS JetStream" --llm-format --fetch

# JSON çıktı
python cli.py search "Docker orchestration" --json-output

# Çoklu sorgu (paralel)
python cli.py multi "GraphRAG" "LangGraph" "PixiJS" --categories it

# Aktif motor listesi
python cli.py engines

# Sağlık kontrolü
python cli.py health
```

## Python API Kullanımı

```python
import asyncio
from deepsearch import quick_search, multi_query_search, format_results_for_llm

# Hızlı arama
async def main():
    # Basit arama
    results = await quick_search("LangGraph agents", categories=["general", "it"])
    print(f"Toplam: {results.total_results} sonuç")
    for r in results.results[:5]:
        print(f"  [{r.score:.2f}] {r.title}")
        print(f"          {r.url}")

    # İçerik çekme ile
    results = await quick_search(
        "GraphRAG architecture patterns",
        categories=["general", "science", "it"],
        fetch_content=True,
        max_results=10,
    )

    # LLM prompt için formatlama
    prompt_text = format_results_for_llm(results, include_full_text=True)
    print(prompt_text)

asyncio.run(main())
```

## Agent Entegrasyonu

### LangChain / LangGraph

```python
from agent_integration import SearXNGSearchTool

tool = SearXNGSearchTool()
lc_tool = tool.as_langchain_tool()

# LangGraph state'inde kullan
from langgraph.graph import StateGraph
# ... graph tanımı
```

### OpenAI Function Calling

```python
tool = SearXNGSearchTool()
schema = tool.openai_function_schema()

# OpenAI API çağrısında tools parametresine ekle
response = client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    tools=[schema],
)
```

### Anthropic Tool Use

```python
tool = SearXNGSearchTool()
schema = tool.anthropic_tool_schema()

# Claude API'de tool olarak kullan
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    tools=[schema],
    messages=[...],
)
```

### MCP Server (Claude Desktop / OpenClaw)

```bash
# MCP server olarak başlat
python agent_integration.py --mcp-server

# Claude Desktop config (~/.config/claude/claude_desktop_config.json)
{
  "mcpServers": {
    "deepsearch": {
      "command": "python",
      "args": ["/path/to/scripts/agent_integration.py", "--mcp-server"],
      "env": {
        "SEARXNG_BASE_URL": "http://localhost:8888"
      }
    }
  }
}
```

## Yapılandırma

### Aktif Motorlar (80+)

| Kategori        | Motorlar                                                   |
|-----------------|------------------------------------------------------------|
| Genel Web       | Google, Bing, DuckDuckGo, Brave, Qwant, Mojeek, Yahoo, Startpage, Yandex |
| Haber           | Google News, Bing News, DuckDuckGo News, Yahoo News, Wikinews, Reuters |
| Akademik        | Google Scholar, arXiv, Semantic Scholar, PubMed, Crossref, OpenAlex, BASE |
| Teknoloji       | GitHub, GitLab, StackOverflow, npm, PyPI, Docker Hub, MDN  |
| Sosyal          | Reddit, Lemmy, HackerNews                                  |
| Video           | YouTube, Dailymotion, Vimeo, Piped                         |
| Görsel          | Google/Bing/DuckDuckGo Images, Flickr, Unsplash, DeviantArt |
| Ansiklopedi     | Wikipedia, Wikidata, Wiktionary, WikiBooks, WikiQuote       |
| Harita          | OpenStreetMap, Photon                                       |
| Müzik           | Bandcamp, Mixcloud, Radio Browser                           |
| Arşiv           | Internet Archive, Archive.org Scholar                       |

### Ortam Değişkenleri (.env)

| Değişken                      | Varsayılan             | Açıklama                    |
|-------------------------------|------------------------|-----------------------------|
| `SEARXNG_PORT`                | `8888`                 | SearXNG HTTP portu          |
| `SEARXNG_BASE_URL`            | `http://localhost:8888`| API base URL                |
| `SEARXNG_SECRET`              | (random)               | Oturum şifreleme anahtarı   |
| `DEEPSEARCH_MAX_RESULTS`      | `50`                   | Maks toplam sonuç           |
| `DEEPSEARCH_TIMEOUT`          | `30`                   | İstek zaman aşımı (s)       |
| `DEEPSEARCH_CACHE_TTL`        | `3600`                 | Önbellek süresi (s)         |

## Dosya Yapısı

```
searxng-deepsearch/
├── docker-compose.yml          # Docker servisleri
├── manage.sh                   # Yönetim scripti
├── .env                        # Ortam değişkenleri
├── settings.yml                # SearXNG ana yapılandırma (80+ motor)
├── limiter.toml                # Rate limiting (API için gevşetilmiş)
├── Caddyfile                   # Reverse proxy (production)
├── requirements.txt            # Python bağımlılıkları
├── deepsearch.py               # Core deep search engine
├── cli.py                      # CLI aracı
└── agent_integration.py        # LangChain/OpenAI/Anthropic/MCP entegrasyonu
└── README.md
```

## Yönetim Komutları

```bash
./manage.sh install   # İlk kurulum
./manage.sh start     # Başlat
./manage.sh stop      # Durdur
./manage.sh restart   # Yeniden başlat
./manage.sh status    # Durum + sağlık kontrolü
./manage.sh logs      # Container logları
./manage.sh test      # Kapsamlı test
./manage.sh update    # İmaj güncelle
./manage.sh reset     # Sıfırla (veri silme)
```

## Production Notları

- **Proxy Rotasyonu**: `settings.yml` içinde `outgoing.proxies` bölümünü etkinleştirin
- **Tor Entegrasyonu**: Tor SOCKS5 proxy ile anonim arama desteği mevcut
- **Caddy TLS**: `docker compose --profile production up` ile otomatik HTTPS
- **Ölçeklendirme**: `deploy.resources` ile CPU/bellek limitleri ayarlı
- **Monitoring**: `enable_metrics: true` ile Prometheus uyumlu metrikler
