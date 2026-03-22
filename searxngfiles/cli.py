#!/usr/bin/env python3
"""
SearXNG Deep Search CLI
========================
Komut satırından güçlü deep search.

Kullanım:
    # Basit arama
    python cli.py search "LangGraph multi-agent"

    # Çoklu kategori + içerik çekme
    python cli.py search "GraphRAG architecture" --categories general it science --fetch

    # Son bir haftanın haberleri
    python cli.py search "Türkiye yapay zeka" --categories news --time-range week

    # Çoklu sorgu (paralel)
    python cli.py multi "GraphRAG" "LangGraph" "NATS JetStream" --categories it

    # LLM formatında çıktı
    python cli.py search "SearXNG API" --llm-format --fetch

    # Sağlık kontrolü
    python cli.py health
"""

import asyncio
import json
import sys
import time

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.markdown import Markdown

from deepsearch import (
    DeepSearchConfig,
    DeepSearchEngine,
    SearchCategory,
    SearchResponse,
    TimeRange,
    format_results_for_llm,
    multi_query_search,
    quick_search,
)

console = Console()

CATEGORY_CHOICES = [c.value for c in SearchCategory]
TIME_CHOICES = [t.value for t in TimeRange if t.value]


def display_results(response: SearchResponse, show_content: bool = False):
    """Sonuçları zengin tablo formatında göster."""
    # Başlık paneli
    console.print(
        Panel(
            f"[bold cyan]Sorgu:[/] {response.query}\n"
            f"[bold green]Sonuç:[/] {response.total_results} | "
            f"[bold yellow]Süre:[/] {response.search_time}s | "
            f"[bold magenta]Kategoriler:[/] {', '.join(response.categories)}",
            title="🔍 Deep Search Sonuçları",
            border_style="cyan",
        )
    )

    # Doğrudan yanıtlar
    if response.answers:
        console.print("\n[bold green]📋 Doğrudan Yanıtlar:[/]")
        for a in response.answers:
            console.print(f"  ✅ {a}")

    # Düzeltmeler
    if response.corrections:
        console.print(
            f"\n[bold yellow]💡 Düzeltme:[/] {', '.join(response.corrections)}"
        )

    # Sonuç tablosu
    table = Table(show_header=True, header_style="bold magenta", show_lines=True)
    table.add_column("#", style="dim", width=3)
    table.add_column("Başlık", style="cyan", max_width=50)
    table.add_column("Motorlar", style="green", max_width=25)
    table.add_column("Skor", style="yellow", width=6)
    table.add_column("URL", style="dim", max_width=60)

    for i, r in enumerate(response.results, 1):
        engines = ", ".join(r.engines[:3])
        if len(r.engines) > 3:
            engines += f" +{len(r.engines)-3}"
        table.add_row(
            str(i),
            r.title[:50],
            engines,
            f"{r.score:.2f}",
            r.url[:60],
        )

    console.print(table)

    # Detaylı içerik
    if show_content:
        for i, r in enumerate(response.results[:10], 1):
            if r.full_text:
                console.print(
                    Panel(
                        r.full_text[:2000],
                        title=f"[{i}] {r.title[:60]}",
                        subtitle=f"{r.token_count} token",
                        border_style="dim",
                    )
                )

    # Öneriler
    if response.suggestions:
        console.print(
            f"\n[bold blue]🔗 İlgili Aramalar:[/] {', '.join(response.suggestions)}"
        )

    # Infobox
    if response.infoboxes:
        for ib in response.infoboxes:
            console.print(
                Panel(
                    ib.get("content", ""),
                    title=f"ℹ️  {ib.get('infobox', 'Bilgi')}",
                    border_style="blue",
                )
            )


@click.group()
def cli():
    """SearXNG Deep Search CLI — Güçlü web araması."""
    pass


@cli.command()
@click.argument("query")
@click.option(
    "--categories", "-c",
    multiple=True,
    default=["general"],
    type=click.Choice(CATEGORY_CHOICES, case_sensitive=False),
    help="Arama kategorileri",
)
@click.option(
    "--time-range", "-t",
    type=click.Choice(TIME_CHOICES, case_sensitive=False),
    default="",
    help="Zaman aralığı filtresi",
)
@click.option("--pages", "-p", default=3, help="Maksimum sayfa sayısı")
@click.option("--fetch/--no-fetch", default=False, help="Tam içerik çek")
@click.option("--max-tokens", default=4000, help="İçerik başına maks token")
@click.option("--json-output", "-j", is_flag=True, help="JSON çıktı")
@click.option("--llm-format", "-l", is_flag=True, help="LLM prompt formatı")
@click.option("--engines", "-e", multiple=True, help="Belirli motorlar")
@click.option("--language", default="auto", help="Arama dili")
def search(
    query, categories, time_range, pages, fetch,
    max_tokens, json_output, llm_format, engines, language,
):
    """Tek sorgu deep search."""

    async def _run():
        cats = [SearchCategory(c) for c in categories]
        tr = TimeRange(time_range) if time_range else TimeRange.NONE
        eng_list = list(engines) if engines else None

        config = DeepSearchConfig(
            query=query,
            categories=cats,
            time_range=tr,
            max_pages=pages,
            fetch_full_content=fetch,
            max_content_tokens=max_tokens,
            engines=eng_list,
            language=language,
        )

        engine = DeepSearchEngine()
        try:
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console,
            ) as progress:
                progress.add_task(
                    f"Arıyor: [cyan]{query}[/] ({', '.join(categories)})",
                    total=None,
                )
                result = await engine.search(config)

            if json_output:
                console.print_json(result.model_dump_json(indent=2))
            elif llm_format:
                console.print(
                    Markdown(format_results_for_llm(result, include_full_text=fetch))
                )
            else:
                display_results(result, show_content=fetch)
        finally:
            await engine.close()

    asyncio.run(_run())


@cli.command()
@click.argument("queries", nargs=-1, required=True)
@click.option(
    "--categories", "-c",
    multiple=True,
    default=["general"],
    type=click.Choice(CATEGORY_CHOICES, case_sensitive=False),
)
@click.option("--fetch/--no-fetch", default=False)
@click.option("--json-output", "-j", is_flag=True)
def multi(queries, categories, fetch, json_output):
    """Çoklu sorgu paralel deep search."""

    async def _run():
        cats = list(categories)
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            progress.add_task(
                f"[cyan]{len(queries)} sorgu[/] paralel aranıyor...",
                total=None,
            )
            results = await multi_query_search(
                list(queries), categories=cats, fetch_content=fetch
            )

        if json_output:
            out = {q: r.model_dump() for q, r in results.items()}
            console.print_json(json.dumps(out, ensure_ascii=False, indent=2))
        else:
            for q, resp in results.items():
                display_results(resp, show_content=fetch)
                console.print()

    asyncio.run(_run())


@cli.command()
def health():
    """SearXNG sunucu sağlık kontrolü."""
    import httpx

    url = f"{DeepSearchEngine().base_url}/search"
    console.print(f"[bold]SearXNG Sağlık Kontrolü[/] — {url}")

    try:
        resp = httpx.get(
            url,
            params={"q": "test", "format": "json", "categories": "general"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            engines_count = len(set(
                e for r in data.get("results", [])
                for e in r.get("engines", [])
            ))
            console.print(f"  [green]✅ Status:[/] OK ({resp.status_code})")
            console.print(f"  [green]✅ Sonuç:[/] {len(data.get('results', []))} sonuç")
            console.print(f"  [green]✅ Aktif Motor:[/] {engines_count} motor yanıt verdi")
        else:
            console.print(f"  [red]❌ Status:[/] {resp.status_code}")
    except Exception as e:
        console.print(f"  [red]❌ Bağlantı Hatası:[/] {e}")

    # Redis kontrolü
    try:
        import redis
        r = redis.from_url("redis://localhost:6379/0")
        r.ping()
        info = r.info("memory")
        console.print(
            f"  [green]✅ Redis:[/] OK "
            f"(Bellek: {info.get('used_memory_human', 'N/A')})"
        )
    except Exception as e:
        console.print(f"  [yellow]⚠️  Redis:[/] {e}")


@cli.command()
def engines():
    """Aktif arama motorlarını listele."""
    import httpx

    try:
        resp = httpx.get(
            f"{DeepSearchEngine().base_url}/search",
            params={"q": "test", "format": "json"},
            timeout=10,
        )
        data = resp.json()
        active = set()
        for r in data.get("results", []):
            active.update(r.get("engines", []))

        table = Table(title="Aktif Arama Motorları", show_header=True)
        table.add_column("#", style="dim", width=4)
        table.add_column("Motor", style="cyan")

        for i, e in enumerate(sorted(active), 1):
            table.add_row(str(i), e)

        console.print(table)
        console.print(f"\n[bold green]Toplam: {len(active)} aktif motor[/]")
    except Exception as e:
        console.print(f"[red]Hata: {e}[/]")


if __name__ == "__main__":
    cli()
