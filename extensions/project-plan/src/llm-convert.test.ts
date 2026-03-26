import { describe, expect, it } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { convertFileToItems, normalizeJsonPayloadToItems } from "./llm-convert.js";
import { parseStructuredTextToItems } from "./text-structure.js";

function createConvertTestApi(assistantText: string): OpenClawPluginApi {
  return {
    config: {
      agents: {
        defaults: {
          id: "main",
        },
      },
    },
    runtime: {
      subagent: {
        run: async () => ({ runId: "run-1" }),
        waitForRun: async () => ({ status: "ok" }),
        getSessionMessages: async () => ({
          messages: [{ role: "assistant", content: assistantText }],
        }),
      },
    },
    logger: {
      warn: () => undefined,
      info: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  } as unknown as OpenClawPluginApi;
}

describe("project-plan JSON fallback normalization", () => {
  it("normalizes sprint -> epic -> task -> subtask payloads without LLM", () => {
    const normalized = normalizeJsonPayloadToItems({
      project: {
        name: "Catalog roadmap",
        description: "Primary roadmap",
        scope: "Catalog expansion",
      },
      currentStateAnchors: {
        knownGaps: ["verifiedOnly filter is not enforced"],
      },
      scopeBoundaries: {
        inScope: ["Import preview"],
        outOfScope: ["Billing"],
      },
      designPrinciples: {
        filterStability: "Keep existing filters stable",
      },
      acceptanceCriteria: ["Import reruns do not create duplicates"],
      sprints: [
        {
          id: "sprint-1",
          name: "Foundation",
          goal: "Stabilize data model",
          epics: [
            {
              id: "EPIC-1",
              name: "Schema Governance",
              description: "Extend schema safely",
              tasks: [
                {
                  id: "TASK-1",
                  name: "Define new fields",
                  assignee_role: "Backend",
                  subtasks: [
                    {
                      id: "SUB-1",
                      name: "Add pluginKind enum",
                      description: "Create initial enum draft",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.type).toBe("epic");
    expect(normalized.items[0]?.title).toBe("Schema Governance");
    expect(normalized.items[0]?.children?.[0]?.type).toBe("task");
    expect(normalized.items[0]?.children?.[0]?.title).toBe("Define new fields");
    expect(normalized.items[0]?.children?.[0]?.children?.[0]?.type).toBe("subtask");
    expect(normalized.items[0]?.children?.[0]?.children?.[0]?.title).toBe("Add pluginKind enum");
  });

  it("copies shared critical context into epic and task descriptions", () => {
    const normalized = normalizeJsonPayloadToItems({
      project: {
        name: "Catalog roadmap",
        description: "Primary roadmap",
      },
      currentStateAnchors: {
        knownGaps: ["Service layer does not apply verifiedOnly"],
      },
      scopeBoundaries: {
        inScope: ["Import preview"],
        outOfScope: ["Billing"],
      },
      designPrinciples: {
        idempotentImports: "Imports must stay idempotent",
      },
      acceptanceCriteria: ["No duplicate entries after rerun"],
      sprints: [
        {
          name: "Foundation",
          epics: [
            {
              name: "Schema Governance",
              tasks: [{ name: "Define new fields" }],
            },
          ],
        },
      ],
    });

    const epic = normalized.items[0];
    const task = epic?.children?.[0];

    expect(epic?.description).toContain("Known Gaps:");
    expect(epic?.description).toContain("Acceptance Criteria:");
    expect(epic?.description).toContain("Design Principles:");
    expect(task?.description).toContain("Known Gaps:");
    expect(task?.description).toContain("Acceptance Criteria:");
    expect(task?.description).toContain("Scope Boundaries:");
  });

  it("normalizes nested roadmap sprints without collapsing them into metadata tasks", () => {
    const normalized = normalizeJsonPayloadToItems({
      project: {
        name: "Ontology-Aware Hybrid Memory OS Master Plan",
        description: "Transformation backlog",
      },
      roadmap: {
        sprints: [
          {
            id: "SPRINT-MOS-01",
            name: "Foundation and Architecture Envelope",
            duration: "2 weeks",
            epics: [
              {
                id: "EPIC-MOS-001",
                name: "Platform Foundation and Bounded Contexts",
                goal: "Define the target-state control plane.",
                tasks: [
                  {
                    id: "TASK-MOS-001",
                    name: "Control plane service and contract map",
                    outcome: "A single source of truth for service contracts.",
                    subtasks: [
                      {
                        id: "SUBTASK-MOS-001A",
                        name: "Architecture contract",
                        objective: "Freeze the bounded context matrix.",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.title).toBe("Platform Foundation and Bounded Contexts");
    expect(normalized.items[0]?.type).toBe("epic");
    expect(normalized.items[0]?.children?.[0]?.title).toBe(
      "Control plane service and contract map",
    );
    expect(normalized.items[0]?.children?.[0]?.children?.[0]?.title).toBe("Architecture contract");
    expect(normalized.items[0]?.description).toContain(
      "Sprint: Foundation and Architecture Envelope",
    );
    expect(normalized.items[0]?.description).toContain("Project context:");
  });

  it("marks generic top-level JSON extraction as low-confidence section fallback", () => {
    const normalized = normalizeJsonPayloadToItems({
      project: {
        name: "Loose JSON",
      },
      interfaces: [
        {
          name: "DocumentStoreConfig",
          purpose: "Store configuration contract",
        },
      ],
      tables: [
        {
          name: "document_stores",
          purpose: "Primary store table",
        },
      ],
    });

    expect(normalized.strategy).toBe("section-fallback");
    expect(normalized.items.map((item) => item.title)).toEqual(["Interfaces", "Tables"]);
  });

  it("normalizes execution_hierarchy plans instead of falling back to metadata sections", () => {
    const normalized = normalizeJsonPayloadToItems({
      meta: {
        project: "GptHouseFlow",
        initiative: "Self-Hosted Tools and Code Interpreter Runtime",
        status: "execution-ready",
        version: "1.0.0",
        description: "Execution-ready master plan",
      },
      implementation_defaults: {
        executor_strategy: "Piston ve Judge0 birlikte desteklenecek",
        session_model: "Stateful session",
      },
      cross_cutting_acceptance_criteria: ["Piston ve Judge0 ayni stack icinde calisir"],
      locked_assumptions: ["v1 public experience Python-first"],
      execution_hierarchy: [
        {
          epic_id: "EPIC-GHF-CI-001",
          title: "Mimari Kontratlar ve Veri Modeli",
          summary: "Ortak execution kontratlari netlestirilir.",
          tasks: [
            {
              task_id: "TASK-GHF-CI-001",
              title: "Execution Domain ve Kontratlar",
              summary: "Backendlerden bagimsiz ortak tipler tanimlanir.",
              subtasks: [
                {
                  subtask_id: "SUBTASK-GHF-CI-001A",
                  title: "Ortak execution type sistemi ve capability modeli tanimla",
                  acceptance_criteria: [
                    "Client'lar ayni result tipini dondurebilir",
                    "Node implementasyonlari backend-ozel parse etmek zorunda kalmaz",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(normalized.strategy).toBe("plan-container");
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.title).toBe("Mimari Kontratlar ve Veri Modeli");
    expect(normalized.items[0]?.type).toBe("epic");
    expect(normalized.items[0]?.children?.[0]?.title).toBe("Execution Domain ve Kontratlar");
    expect(normalized.items[0]?.children?.[0]?.type).toBe("task");
    expect(normalized.items[0]?.children?.[0]?.children?.[0]?.title).toBe(
      "Ortak execution type sistemi ve capability modeli tanimla",
    );
    expect(normalized.items[0]?.description).toContain("Plan context:");
    expect(normalized.items[0]?.description).toContain("Implementation Defaults:");
    expect(normalized.items[0]?.description).toContain("Acceptance Criteria:");
    expect(normalized.items[0]?.description).toContain("Locked Assumptions:");
  });
});

describe("project-plan JSON LLM review", () => {
  it("routes direct JSON imports through LLM verification", async () => {
    const api = createConvertTestApi('{"approved":true}');
    const payload = {
      items: [
        {
          title: "Platform",
          type: "epic",
          children: [{ title: "Build ingestion pipeline", type: "task" }],
        },
      ],
    };

    const result = await convertFileToItems({
      content: JSON.stringify(payload),
      filename: "plan.json",
      api,
    });

    expect(result.method).toBe("json-direct+llm-verified");
    expect(JSON.parse(result.json)).toEqual(payload);
  });

  it("routes normalized JSON imports through LLM verification", async () => {
    const api = createConvertTestApi('{"approved":true}');

    const result = await convertFileToItems({
      content: JSON.stringify({
        execution_hierarchy: [
          {
            title: "Mimari Kontratlar ve Veri Modeli",
            tasks: [
              {
                title: "Execution Domain ve Kontratlar",
                subtasks: [{ title: "Capability modeli tanimla" }],
              },
            ],
          },
        ],
      }),
      filename: "plan.json",
      api,
    });

    const parsed = JSON.parse(result.json) as { items: Array<{ title: string }> };
    expect(result.method).toBe("json-fallback+llm-verified");
    expect(parsed.items[0]?.title).toBe("Mimari Kontratlar ve Veri Modeli");
  });

  it("keeps the deterministic JSON candidate when LLM review returns unusable output", async () => {
    const api = createConvertTestApi('{"approved":false,"items":"broken"}');

    const result = await convertFileToItems({
      content: JSON.stringify({
        execution_hierarchy: [
          {
            title: "Mimari Kontratlar ve Veri Modeli",
            tasks: [{ title: "Execution Domain ve Kontratlar" }],
          },
        ],
      }),
      filename: "plan.json",
      api,
    });

    const parsed = JSON.parse(result.json) as { items: Array<{ title: string }> };
    expect(result.method).toBe("json-fallback");
    expect(parsed.items[0]?.title).toBe("Mimari Kontratlar ve Veri Modeli");
  });
});

describe("project-plan structured text normalization", () => {
  it("maps markdown sections into epics with grouped tasks and subtasks", () => {
    const normalized = parseStructuredTextToItems({
      markdown: true,
      content: `
# Plugin Store Catalog Roadmap JSON

## Özet
Yeni plan dosyası PLUGIN_STORE_PLAN.json olarak oluşturulsun ve mevcut yaklaşımı korusun.

Planın temel gerçekleri mevcut store koduna sabitlensin:
- Kategori ekseni mevcut sidebar ile aynı kalsın
- Filtre davranışı mevcut bar ile uyumlu kalsın
- Veri modeli Plugin üstünden devam etsin

## Arayüz ve Veri Modeli Kararları
Mevcut Plugin şemasına şu alanlar eklensin:
- pluginKind: connector | service | app | project | template
- deploymentMode: api | docker_image | python_package

Filtre kararı:
- v1'de yeni bir app/project filtresi eklenmesin
- pluginKind sadece kart badge'i tarafında gösterilsin
      `.trim(),
    });

    expect(normalized.items).toHaveLength(2);
    expect(normalized.items[0]?.title).toBe("Özet");
    expect(normalized.items[0]?.type).toBe("epic");
    expect(normalized.items[0]?.description).toContain(
      "Document: Plugin Store Catalog Roadmap JSON",
    );
    expect(normalized.items[0]?.description).toContain("Yeni plan dosyası");
    expect(normalized.items[0]?.children?.[0]?.title).toBe(
      "Planın temel gerçekleri mevcut store koduna sabitlensin",
    );
    expect(normalized.items[0]?.children?.[0]?.type).toBe("task");
    expect(normalized.items[0]?.children?.[0]?.children?.map((item) => item.title)).toEqual([
      "Kategori ekseni mevcut sidebar ile aynı kalsın",
      "Filtre davranışı mevcut bar ile uyumlu kalsın",
      "Veri modeli Plugin üstünden devam etsin",
    ]);
    expect(normalized.items[1]?.children?.map((item) => item.title)).toEqual([
      "Mevcut Plugin şemasına şu alanlar eklensin",
      "Filtre kararı",
    ]);
  });

  it("keeps grouped catalog entries as descriptions instead of exploding every wrapped line", () => {
    const normalized = parseStructuredTextToItems({
      markdown: true,
      content: `
# Catalog

## Katalog Kapsamı
launchCatalog başlangıç hedefi 38 kayıt olsun:
- OCR:
  Tesseract, PaddleOCR, EasyOCR
- VisionLLM:
  OpenAI Vision Connector, Claude Vision Connector
      `.trim(),
    });

    const catalogTask = normalized.items[0]?.children?.[0];
    expect(catalogTask?.title).toBe("launchCatalog başlangıç hedefi 38 kayıt olsun");
    expect(catalogTask?.children?.[0]?.title).toBe("OCR");
    expect(catalogTask?.children?.[0]?.description).toContain("Tesseract");
    expect(catalogTask?.children?.[1]?.title).toBe("VisionLLM");
    expect(catalogTask?.children?.[1]?.description).toContain("Claude Vision Connector");
  });

  it("groups plain-text colon blocks into tasks with subtasks", () => {
    const normalized = parseStructuredTextToItems({
      content: `
Temel kararlar:
- Verified filtre kalsın
- Search identifier alanını da tarasın

Katalog kuralları:
- Her kayıt tek primary category alsın
- secondaryTags ile genişletilsin
      `.trim(),
    });

    expect(normalized.items.map((item) => item.title)).toEqual([
      "Temel kararlar",
      "Katalog kuralları",
    ]);
    expect(normalized.items[0]?.children?.map((item) => item.title)).toEqual([
      "Verified filtre kalsın",
      "Search identifier alanını da tarasın",
    ]);
  });
});
