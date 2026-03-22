"""
SearXNG Agent Integration
===========================
LangChain, LangGraph, OpenClaw ve diğer AI agent frameworkleri için
SearXNG deep search tool entegrasyonu.

Kullanım:

    # Standalone
    tool = SearXNGSearchTool()
    result = await tool.invoke("GraphRAG mimarisi nedir?")

    # LangChain Tool olarak
    from langchain_core.tools import StructuredTool
    lc_tool = tool.as_langchain_tool()

    # OpenAI function calling formatında
    schema = tool.openai_function_schema()

    # MCP Server olarak (stdin/stdout)
    python agent_integration.py --mcp-server
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

from pydantic import BaseModel, Field

from deepsearch import (
    DeepSearchConfig,
    DeepSearchEngine,
    SearchCategory,
    SearchResponse,
    TimeRange,
    format_results_for_llm,
)

logger = logging.getLogger("deepsearch.agent")


# =============================================================================
# TOOL SCHEMAS — LLM function calling için
# =============================================================================

class SearchInput(BaseModel):
    """Arama aracı giriş şeması."""
    query: str = Field(description="Arama sorgusu")
    categories: list[str] = Field(
        default=["general"],
        description=(
            "Aranacak kategoriler. Seçenekler: general, news, science, "
            "it, images, videos, music, files, 'social media', map"
        ),
    )
    time_range: str = Field(
        default="",
        description="Zaman filtresi: day, week, month, year veya boş",
    )
    max_results: int = Field(
        default=10,
        description="Maksimum sonuç sayısı (1-50)",
        ge=1,
        le=50,
    )
    fetch_content: bool = Field(
        default=False,
        description="True ise sonuç URL'lerinden tam metin çeker",
    )
    language: str = Field(
        default="auto",
        description="Arama dili (ör: tr, en, de, auto)",
    )


class FetchPageInput(BaseModel):
    """Sayfa içerik çekme aracı giriş şeması."""
    url: str = Field(description="İçeriği çekilecek URL")
    max_tokens: int = Field(
        default=4000,
        description="Maksimum token sayısı",
        ge=100,
        le=32000,
    )


# =============================================================================
# SEARCH TOOL
# =============================================================================

class SearXNGSearchTool:
    """
    AI agent'lar için SearXNG deep search aracı.

    Bu sınıf:
    - Standalone kullanılabilir
    - LangChain Tool'a dönüştürülebilir
    - OpenAI function calling şeması üretir
    - MCP tool olarak çalışabilir
    """

    name = "web_search"
    description = (
        "İnternet üzerinde kapsamlı arama yapar. Google, Bing, DuckDuckGo, "
        "Brave, akademik veritabanları (arXiv, Semantic Scholar, PubMed), "
        "GitHub, StackOverflow ve 80+ arama motorunu paralel sorgular. "
        "Opsiyonel olarak sonuç sayfalarının tam içeriğini çeker."
    )

    def __init__(
        self,
        base_url: str = os.getenv("SEARXNG_BASE_URL", "http://localhost:8888"),
        default_categories: Optional[list[str]] = None,
        default_max_results: int = 10,
        use_cache: bool = True,
    ):
        self.engine = DeepSearchEngine(base_url=base_url, use_cache=use_cache)
        self.default_categories = default_categories or ["general"]
        self.default_max_results = default_max_results

    async def invoke(
        self,
        query: str,
        categories: Optional[list[str]] = None,
        time_range: str = "",
        max_results: int = 0,
        fetch_content: bool = False,
        language: str = "auto",
    ) -> str:
        """
        Arama yap ve LLM-ready formatlı string döndür.
        """
        cats = [
            SearchCategory(c)
            for c in (categories or self.default_categories)
        ]
        tr = TimeRange(time_range) if time_range else TimeRange.NONE
        mr = max_results or self.default_max_results

        config = DeepSearchConfig(
            query=query,
            categories=cats,
            time_range=tr,
            max_results_per_category=mr,
            fetch_full_content=fetch_content,
            language=language,
        )

        response = await self.engine.search(config)
        return format_results_for_llm(
            response, include_full_text=fetch_content, max_results=mr
        )

    async def invoke_structured(self, input: SearchInput) -> SearchResponse:
        """Yapılandırılmış girdi ile arama — ham SearchResponse döndürür."""
        cats = [SearchCategory(c) for c in input.categories]
        tr = TimeRange(input.time_range) if input.time_range else TimeRange.NONE

        config = DeepSearchConfig(
            query=input.query,
            categories=cats,
            time_range=tr,
            max_results_per_category=input.max_results,
            fetch_full_content=input.fetch_content,
            language=input.language,
        )

        return await self.engine.search(config)

    def openai_function_schema(self) -> dict:
        """OpenAI function calling şeması döndür."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": SearchInput.model_json_schema(),
            },
        }

    def anthropic_tool_schema(self) -> dict:
        """Anthropic tool use şeması döndür."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": SearchInput.model_json_schema(),
        }

    def as_langchain_tool(self):
        """LangChain StructuredTool olarak döndür."""
        try:
            from langchain_core.tools import StructuredTool
        except ImportError:
            raise ImportError("langchain-core gerekli: pip install langchain-core")

        async def _run(
            query: str,
            categories: list[str] = ["general"],
            time_range: str = "",
            max_results: int = 10,
            fetch_content: bool = False,
            language: str = "auto",
        ) -> str:
            return await self.invoke(
                query=query,
                categories=categories,
                time_range=time_range,
                max_results=max_results,
                fetch_content=fetch_content,
                language=language,
            )

        return StructuredTool.from_function(
            coroutine=_run,
            name=self.name,
            description=self.description,
            args_schema=SearchInput,
        )

    async def close(self):
        await self.engine.close()


# =============================================================================
# FETCH PAGE TOOL
# =============================================================================

class FetchPageTool:
    """URL'den tam metin çeken ek araç."""

    name = "fetch_page"
    description = (
        "Belirtilen URL'den web sayfasının tam metin içeriğini çeker. "
        "HTML'i temizleyip markdown formatına çevirir. "
        "Arama sonuçlarının detayını görmek için kullanılır."
    )

    def __init__(self):
        from deepsearch import ContentFetcher
        self.fetcher = ContentFetcher()

    async def invoke(self, url: str, max_tokens: int = 4000) -> str:
        import httpx
        self.fetcher.max_tokens = max_tokens
        async with httpx.AsyncClient() as client:
            text = await self.fetcher.fetch(url, client)
            return text or f"İçerik çekilemedi: {url}"

    def openai_function_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": FetchPageInput.model_json_schema(),
            },
        }

    def anthropic_tool_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": FetchPageInput.model_json_schema(),
        }


# =============================================================================
# MCP SERVER (stdin/stdout protocol)
# =============================================================================

async def run_mcp_server():
    """
    MCP (Model Context Protocol) server olarak çalıştır.
    Claude Desktop, OpenClaw gibi araçlarla entegrasyon için.

    stdin/stdout üzerinden JSON-RPC 2.0 protokolü kullanır.
    """
    import sys

    search_tool = SearXNGSearchTool()
    fetch_tool = FetchPageTool()

    tools = {
        "web_search": {
            "tool": search_tool,
            "schema": search_tool.anthropic_tool_schema(),
        },
        "fetch_page": {
            "tool": fetch_tool,
            "schema": fetch_tool.anthropic_tool_schema(),
        },
    }

    async def handle_request(request: dict) -> dict:
        method = request.get("method", "")
        req_id = request.get("id")

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": "searxng-deepsearch",
                        "version": "1.0.0",
                    },
                },
            }

        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [t["schema"] for t in tools.values()]
                },
            }

        elif method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name", "")
            arguments = params.get("arguments", {})

            if tool_name == "web_search":
                result = await search_tool.invoke(**arguments)
            elif tool_name == "fetch_page":
                result = await fetch_tool.invoke(**arguments)
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Tool not found: {tool_name}"},
                }

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "text", "text": result}],
                    "isError": False,
                },
            }

        elif method == "notifications/initialized":
            return None  # No response needed

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }

    # stdin/stdout loop
    logger.info("MCP Server başlatıldı (stdin/stdout)")

    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin.buffer)

    w_transport, w_protocol = await asyncio.get_event_loop().connect_write_pipe(
        asyncio.streams.FlowControlMixin, sys.stdout.buffer
    )
    writer = asyncio.StreamWriter(w_transport, w_protocol, reader, asyncio.get_event_loop())

    while True:
        try:
            line = await reader.readline()
            if not line:
                break

            request = json.loads(line.decode().strip())
            response = await handle_request(request)

            if response:
                out = json.dumps(response, ensure_ascii=False) + "\n"
                writer.write(out.encode())
                await writer.drain()

        except json.JSONDecodeError:
            continue
        except Exception as e:
            logger.error(f"MCP hatası: {e}")
            continue

    await search_tool.close()


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import sys

    if "--mcp-server" in sys.argv:
        logging.basicConfig(level=logging.INFO)
        asyncio.run(run_mcp_server())
    else:
        # Hızlı test
        async def test():
            tool = SearXNGSearchTool()
            try:
                result = await tool.invoke(
                    "LangGraph multi-agent architecture",
                    categories=["general", "it"],
                    max_results=5,
                )
                print(result)
            finally:
                await tool.close()

        asyncio.run(test())
