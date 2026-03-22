"""
SearXNG Deep Search Client
===========================
Programatik deep web araması için kapsamlı Python istemcisi.

Özellikler:
  - Çoklu kategori paralel arama
  - Otomatik sayfalama (pagination)
  - Sonuç deduplikasyonu
  - Redis önbellek entegrasyonu
  - Tam sayfa içerik çekme (fetch & extract)
  - Token sayımı (LLM context window yönetimi)
  - Retry / backoff mekanizması
  - Zengin CLI çıktısı
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Optional
from urllib.parse import quote_plus, urljoin, urlparse

import httpx
import html2text
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential

load_dotenv()

logger = logging.getLogger("deepsearch")

# =============================================================================
# CONFIGURATION
# =============================================================================

SEARXNG_URL = os.getenv("SEARXNG_BASE_URL", "http://localhost:8888")
REDIS_URL = os.getenv("SEARXNG_REDIS_URL", "redis://localhost:6379/0")
DEFAULT_TIMEOUT = int(os.getenv("DEEPSEARCH_TIMEOUT", "30"))
MAX_RESULTS = int(os.getenv("DEEPSEARCH_MAX_RESULTS", "50"))
CACHE_TTL = int(os.getenv("DEEPSEARCH_CACHE_TTL", "3600"))


class SearchCategory(str, Enum):
    GENERAL = "general"
    NEWS = "news"
    SCIENCE = "science"
    IT = "it"
    IMAGES = "images"
    VIDEOS = "videos"
    MUSIC = "music"
    FILES = "files"
    SOCIAL = "social media"
    MAP = "map"


class TimeRange(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    YEAR = "year"
    NONE = ""


# =============================================================================
# DATA MODELS
# =============================================================================

class SearchResult(BaseModel):
    """Tek bir arama sonucu."""
    title: str = ""
    url: str = ""
    content: str = ""
    engine: str = ""
    engines: list[str] = Field(default_factory=list)
    score: float = 0.0
    category: str = ""
    publishedDate: Optional[str] = None
    thumbnail: Optional[str] = None
    img_src: Optional[str] = None
    # Fetch sonucu eklenir
    full_text: Optional[str] = None
    token_count: Optional[int] = None


class SearchResponse(BaseModel):
    """Arama yanıtı."""
    query: str
    results: list[SearchResult] = Field(default_factory=list)
    total_results: int = 0
    search_time: float = 0.0
    categories: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    corrections: list[str] = Field(default_factory=list)
    infoboxes: list[dict] = Field(default_factory=list)
    answers: list[str] = Field(default_factory=list)


class DeepSearchConfig(BaseModel):
    """Deep search yapılandırması."""
    query: str
    categories: list[SearchCategory] = Field(
        default_factory=lambda: [SearchCategory.GENERAL]
    )
    time_range: TimeRange = TimeRange.NONE
    language: str = "auto"
    max_results_per_category: int = 20
    max_pages: int = 3
    fetch_full_content: bool = False
    max_content_tokens: int = 4000
    engines: Optional[list[str]] = None
    safesearch: int = 0
    # Paralel istek sayısı
    concurrency: int = 5


# =============================================================================
# REDIS CACHE (opsiyonel)
# =============================================================================

class SearchCache:
    """Redis tabanlı arama önbelleği."""

    def __init__(self, redis_url: str = REDIS_URL, ttl: int = CACHE_TTL):
        self.ttl = ttl
        self._redis = None
        self._redis_url = redis_url

    async def _get_redis(self):
        if self._redis is None:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(
                    self._redis_url, decode_responses=True
                )
                await self._redis.ping()
            except Exception as e:
                logger.warning(f"Redis bağlantısı kurulamadı: {e}")
                self._redis = None
        return self._redis

    def _cache_key(self, query: str, category: str, page: int) -> str:
        raw = f"{query}:{category}:{page}"
        return f"deepsearch:{hashlib.md5(raw.encode()).hexdigest()}"

    async def get(self, query: str, category: str, page: int) -> Optional[dict]:
        r = await self._get_redis()
        if r is None:
            return None
        try:
            data = await r.get(self._cache_key(query, category, page))
            return json.loads(data) if data else None
        except Exception:
            return None

    async def set(self, query: str, category: str, page: int, data: dict):
        r = await self._get_redis()
        if r is None:
            return
        try:
            await r.setex(
                self._cache_key(query, category, page),
                self.ttl,
                json.dumps(data, ensure_ascii=False),
            )
        except Exception as e:
            logger.warning(f"Cache yazma hatası: {e}")

    async def close(self):
        if self._redis:
            await self._redis.close()


# =============================================================================
# CONTENT FETCHER — Tam sayfa içerik çekme
# =============================================================================

class ContentFetcher:
    """URL'den tam metin çeker ve temizler."""

    def __init__(self, timeout: int = 15, max_tokens: int = 4000):
        self.timeout = timeout
        self.max_tokens = max_tokens
        self._h2t = html2text.HTML2Text()
        self._h2t.ignore_links = True
        self._h2t.ignore_images = True
        self._h2t.ignore_tables = False
        self._h2t.body_width = 0
        self._h2t.unicode_snob = True

    async def fetch(self, url: str, client: httpx.AsyncClient) -> Optional[str]:
        """URL'den içerik çek ve markdown'a çevir."""
        try:
            resp = await client.get(
                url,
                follow_redirects=True,
                timeout=self.timeout,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "tr,en;q=0.9",
                },
            )
            if resp.status_code != 200:
                return None

            content_type = resp.headers.get("content-type", "")
            if "text/html" not in content_type:
                return None

            soup = BeautifulSoup(resp.text, "html.parser")

            # Gereksiz elementleri kaldır
            for tag in soup.find_all(
                ["script", "style", "nav", "footer", "header",
                 "aside", "iframe", "noscript", "svg", "form"]
            ):
                tag.decompose()

            # Ana içerik bölümünü bul
            main = (
                soup.find("article")
                or soup.find("main")
                or soup.find(attrs={"role": "main"})
                or soup.find("div", class_=re.compile(r"content|article|post|entry"))
                or soup.body
            )

            if main is None:
                return None

            text = self._h2t.handle(str(main))
            text = self._clean_text(text)

            # Token limiti uygula
            if len(text) > self.max_tokens * 4:
                text = text[: self.max_tokens * 4]

            return text if len(text) > 100 else None

        except Exception as e:
            logger.debug(f"Fetch hatası ({url}): {e}")
            return None

    @staticmethod
    def _clean_text(text: str) -> str:
        """Metni temizle."""
        # Çoklu boş satırları kısalt
        text = re.sub(r"\n{3,}", "\n\n", text)
        # Baştaki/sondaki boşlukları kaldır
        text = "\n".join(line.strip() for line in text.splitlines())
        return text.strip()


# =============================================================================
# DEEP SEARCH ENGINE
# =============================================================================

class DeepSearchEngine:
    """
    SearXNG üzerinde deep search yapan ana motor.

    Kullanım:
        engine = DeepSearchEngine()
        results = await engine.search(DeepSearchConfig(
            query="LangGraph multi-agent architecture",
            categories=[SearchCategory.GENERAL, SearchCategory.IT, SearchCategory.SCIENCE],
            max_pages=3,
            fetch_full_content=True
        ))
    """

    def __init__(
        self,
        base_url: str = SEARXNG_URL,
        timeout: int = DEFAULT_TIMEOUT,
        use_cache: bool = True,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.cache = SearchCache() if use_cache else None
        self.fetcher = ContentFetcher()
        self._seen_urls: set[str] = set()

    async def search(self, config: DeepSearchConfig) -> SearchResponse:
        """
        Deep search gerçekleştir.

        1. Her kategori için paralel arama
        2. Sayfalama ile ek sonuçlar
        3. Deduplikasyon
        4. Opsiyonel tam içerik çekme
        """
        start = time.monotonic()
        self._seen_urls.clear()

        all_results: list[SearchResult] = []
        all_suggestions: set[str] = set()
        all_corrections: set[str] = set()
        all_answers: list[str] = []
        all_infoboxes: list[dict] = []

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            # ── Paralel kategori araması ──
            sem = asyncio.Semaphore(config.concurrency)
            tasks = []

            for category in config.categories:
                for page in range(1, config.max_pages + 1):
                    tasks.append(
                        self._search_page(
                            client, sem, config, category.value, page
                        )
                    )

            responses = await asyncio.gather(*tasks, return_exceptions=True)

            for resp in responses:
                if isinstance(resp, Exception):
                    logger.warning(f"Arama hatası: {resp}")
                    continue
                if resp is None:
                    continue

                for r in resp.get("results", []):
                    result = self._parse_result(r)
                    if result and result.url not in self._seen_urls:
                        self._seen_urls.add(result.url)
                        all_results.append(result)

                all_suggestions.update(resp.get("suggestions", []))
                all_corrections.update(resp.get("corrections", []))
                all_answers.extend(resp.get("answers", []))
                all_infoboxes.extend(resp.get("infoboxes", []))

            # ── Skorla sırala ──
            all_results.sort(key=lambda r: r.score, reverse=True)

            # ── Limit uygula ──
            if len(all_results) > MAX_RESULTS:
                all_results = all_results[:MAX_RESULTS]

            # ── Tam içerik çekme (opsiyonel) ──
            if config.fetch_full_content:
                self.fetcher.max_tokens = config.max_content_tokens
                fetch_tasks = []
                for result in all_results:
                    fetch_tasks.append(
                        self._fetch_content(client, sem, result)
                    )
                await asyncio.gather(*fetch_tasks, return_exceptions=True)

        elapsed = time.monotonic() - start

        return SearchResponse(
            query=config.query,
            results=all_results,
            total_results=len(all_results),
            search_time=round(elapsed, 2),
            categories=[c.value for c in config.categories],
            suggestions=sorted(all_suggestions),
            corrections=sorted(all_corrections),
            answers=all_answers,
            infoboxes=all_infoboxes,
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
    )
    async def _search_page(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        config: DeepSearchConfig,
        category: str,
        page: int,
    ) -> Optional[dict]:
        """Tek bir sayfa arama yap."""
        async with sem:
            # Önbellekten kontrol
            if self.cache:
                cached = await self.cache.get(config.query, category, page)
                if cached:
                    logger.debug(f"Cache hit: {config.query} [{category}] p{page}")
                    return cached

            params: dict[str, Any] = {
                "q": config.query,
                "format": "json",
                "categories": category,
                "pageno": page,
                "language": config.language,
                "safesearch": config.safesearch,
            }

            if config.time_range != TimeRange.NONE:
                params["time_range"] = config.time_range.value

            if config.engines:
                params["engines"] = ",".join(config.engines)

            try:
                resp = await client.get(
                    f"{self.base_url}/search",
                    params=params,
                    headers={"Accept": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()

                # Önbelleğe kaydet
                if self.cache:
                    await self.cache.set(config.query, category, page, data)

                return data

            except httpx.HTTPStatusError as e:
                logger.warning(
                    f"HTTP {e.response.status_code}: {config.query} [{category}] p{page}"
                )
                if e.response.status_code == 429:
                    await asyncio.sleep(5)
                raise
            except Exception as e:
                logger.warning(f"Arama hatası: {e}")
                raise

    async def _fetch_content(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        result: SearchResult,
    ):
        """Sonuç URL'inden tam içerik çek."""
        async with sem:
            text = await self.fetcher.fetch(result.url, client)
            if text:
                result.full_text = text
                # Yaklaşık token sayımı (4 char ≈ 1 token)
                result.token_count = len(text) // 4

    @staticmethod
    def _parse_result(raw: dict) -> Optional[SearchResult]:
        """Ham SearXNG sonucunu parse et."""
        url = raw.get("url", "")
        if not url:
            return None
        return SearchResult(
            title=raw.get("title", ""),
            url=url,
            content=raw.get("content", ""),
            engine=raw.get("engine", ""),
            engines=raw.get("engines", []),
            score=raw.get("score", 0.0),
            category=raw.get("category", ""),
            publishedDate=raw.get("publishedDate"),
            thumbnail=raw.get("thumbnail"),
            img_src=raw.get("img_src"),
        )

    async def close(self):
        """Kaynakları temizle."""
        if self.cache:
            await self.cache.close()


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

async def quick_search(
    query: str,
    categories: Optional[list[str]] = None,
    max_results: int = 20,
    fetch_content: bool = False,
    time_range: str = "",
) -> SearchResponse:
    """
    Hızlı deep search.

    Kullanım:
        results = await quick_search("LangGraph agents", categories=["general", "it"])
    """
    cats = [SearchCategory(c) for c in (categories or ["general"])]
    tr = TimeRange(time_range) if time_range else TimeRange.NONE

    engine = DeepSearchEngine()
    try:
        return await engine.search(
            DeepSearchConfig(
                query=query,
                categories=cats,
                time_range=tr,
                max_results_per_category=max_results,
                fetch_full_content=fetch_content,
            )
        )
    finally:
        await engine.close()


async def multi_query_search(
    queries: list[str],
    categories: Optional[list[str]] = None,
    fetch_content: bool = False,
) -> dict[str, SearchResponse]:
    """
    Birden fazla sorgu için paralel deep search.

    Kullanım:
        results = await multi_query_search([
            "GraphRAG architecture",
            "LangGraph multi-agent",
            "NATS JetStream messaging"
        ])
    """
    engine = DeepSearchEngine()
    cats = [SearchCategory(c) for c in (categories or ["general"])]

    try:
        tasks = {}
        for q in queries:
            config = DeepSearchConfig(
                query=q,
                categories=cats,
                fetch_full_content=fetch_content,
            )
            tasks[q] = engine.search(config)

        results = {}
        responses = await asyncio.gather(
            *tasks.values(), return_exceptions=True
        )
        for query, resp in zip(tasks.keys(), responses):
            if isinstance(resp, Exception):
                logger.error(f"Sorgu hatası ({query}): {resp}")
                continue
            results[query] = resp

        return results
    finally:
        await engine.close()


def format_results_for_llm(
    response: SearchResponse,
    include_full_text: bool = False,
    max_results: int = 10,
) -> str:
    """
    Arama sonuçlarını LLM context'i için formatlı metin olarak döndür.

    Bu fonksiyon, sonuçları doğrudan bir LLM promptuna eklemek için optimize eder.
    """
    parts = [
        f"## Arama Sonuçları: \"{response.query}\"",
        f"Toplam: {response.total_results} sonuç | Süre: {response.search_time}s",
        f"Kategoriler: {', '.join(response.categories)}",
        "",
    ]

    if response.answers:
        parts.append("### Doğrudan Yanıtlar")
        for a in response.answers:
            parts.append(f"- {a}")
        parts.append("")

    if response.corrections:
        parts.append(f"### Düzeltme Önerileri: {', '.join(response.corrections)}")
        parts.append("")

    for i, r in enumerate(response.results[:max_results], 1):
        parts.append(f"### [{i}] {r.title}")
        parts.append(f"**URL:** {r.url}")
        parts.append(f"**Motorlar:** {', '.join(r.engines)} | **Skor:** {r.score:.2f}")
        if r.publishedDate:
            parts.append(f"**Tarih:** {r.publishedDate}")
        if r.content:
            parts.append(f"**Özet:** {r.content}")
        if include_full_text and r.full_text:
            parts.append(f"**İçerik ({r.token_count} token):**")
            parts.append(r.full_text[:8000])
        parts.append("")

    if response.suggestions:
        parts.append(f"### İlgili Aramalar: {', '.join(response.suggestions)}")

    return "\n".join(parts)
