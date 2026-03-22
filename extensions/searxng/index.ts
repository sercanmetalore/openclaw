import { definePluginEntry } from "openclaw/plugin-sdk/core";

// ── SearXNG response types ──────────────────────────────────────────────────

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
  engine: string;
  category?: string;
  score?: number;
}

interface SearXNGResponse {
  query: string;
  number_of_results: number;
  results: SearXNGResult[];
  suggestions?: string[];
  infoboxes?: Array<{ infobox: string; content: string; urls?: Array<{ title: string; url: string }> }>;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_SEARXNG_BASE_URL = "http://localhost:8888";
const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;

function resolveBaseUrl(searchConfig?: Record<string, unknown>): string | undefined {
  const scoped = searchConfig?.searxng;
  if (!scoped || typeof scoped !== "object" || Array.isArray(scoped)) {
    return process.env.SEARXNG_BASE_URL || undefined;
  }
  const baseUrl = (scoped as Record<string, unknown>).baseUrl;
  if (typeof baseUrl === "string" && baseUrl.trim()) {
    return baseUrl.trim().replace(/\/+$/, "");
  }
  return process.env.SEARXNG_BASE_URL || undefined;
}

// ── SearXNG web search provider ─────────────────────────────────────────────

const searxngProvider = {
  id: "searxng" as string,
  label: "SearXNG (Self-Hosted)",
  hint: "Self-hosted meta-search · 70+ engines · no API key required",
  envVars: ["SEARXNG_BASE_URL"],
  placeholder: "http://localhost:8888",
  signupUrl: "https://docs.searxng.org/admin/installation-docker.html",
  autoDetectOrder: 5,

  getCredentialValue(searchConfig?: Record<string, unknown>): unknown {
    return resolveBaseUrl(searchConfig);
  },

  setCredentialValue(searchConfigTarget: Record<string, unknown>, value: unknown): void {
    if (!searchConfigTarget.searxng || typeof searchConfigTarget.searxng !== "object") {
      searchConfigTarget.searxng = {};
    }
    (searchConfigTarget.searxng as Record<string, unknown>).baseUrl = value;
  },

  createTool(ctx: { config?: unknown; searchConfig?: Record<string, unknown>; runtimeMetadata?: unknown }) {
    const baseUrl = resolveBaseUrl(ctx.searchConfig) ?? DEFAULT_SEARXNG_BASE_URL;

    return {
      description:
        "Search the web using SearXNG (self-hosted meta-search engine). " +
        "Returns structured results from multiple search engines (Google, Bing, DuckDuckGo, etc.).",

      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string.",
          },
          count: {
            type: "number",
            description: `Number of results to return (default ${DEFAULT_COUNT}, max ${MAX_COUNT}).`,
          },
          categories: {
            type: "string",
            description:
              'Comma-separated SearXNG categories to search (e.g. "general", "science", "it", "news"). Default: "general".',
          },
          language: {
            type: "string",
            description:
              'Search language code (e.g. "en", "tr", "de"). Default: "all".',
          },
        },
        required: ["query"],
        additionalProperties: false,
      },

      async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
        const query = String(args.query ?? "").trim();
        if (!query) {
          return { error: "Missing required parameter: query" };
        }

        const count = Math.min(
          Math.max(1, Number(args.count) || DEFAULT_COUNT),
          MAX_COUNT,
        );
        const categories = String(args.categories ?? "general");
        const language = String(args.language ?? "all");

        // Build search URL
        const params = new URLSearchParams({
          q: query,
          format: "json",
          categories,
          language,
          pageno: "1",
        });

        const searchUrl = `${baseUrl}/search?${params.toString()}`;

        try {
          const response = await fetch(searchUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              "User-Agent": "OpenClaw-IdeaForge/1.0",
            },
            signal: AbortSignal.timeout(30_000),
          });

          if (!response.ok) {
            return {
              error: `SearXNG request failed: ${response.status} ${response.statusText}`,
            };
          }

          const data = (await response.json()) as SearXNGResponse;
          const results = (data.results ?? []).slice(0, count);

          const formattedResults = results.map((r, i) => ({
            position: i + 1,
            title: r.title ?? "",
            url: r.url ?? "",
            snippet: r.content ?? "",
            engine: r.engine ?? "unknown",
          }));

          return {
            query: data.query ?? query,
            total_results: data.number_of_results ?? results.length,
            results: formattedResults,
            suggestions: data.suggestions ?? [],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("abort") || message.includes("timeout")) {
            return { error: `SearXNG request timed out after 30s. Is SearXNG running at ${baseUrl}?` };
          }
          return {
            error: `SearXNG search failed: ${message}. Ensure SearXNG is running at ${baseUrl}`,
          };
        }
      },
    };
  },
};

// ── Plugin entry ────────────────────────────────────────────────────────────

export default definePluginEntry({
  id: "searxng",
  name: "SearXNG Plugin",
  description: "Self-hosted SearXNG meta-search provider (no API key required)",
  register(api) {
    api.registerWebSearchProvider(searxngProvider);
  },
});
