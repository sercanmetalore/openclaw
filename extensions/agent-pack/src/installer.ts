// ── Agent Pack Installer Service ──────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { PLANNER_AGENTS } from "./agents/planner.js";
import { QA_TESTING_AGENTS } from "./agents/qa-testing.js";
import { SOFTDEV_AGENTS } from "./agents/softdev.js";
import type { AgentDefinition, AgentFiles } from "./types.js";

const ALL_AGENTS: AgentDefinition[] = [...SOFTDEV_AGENTS, ...PLANNER_AGENTS, ...QA_TESTING_AGENTS];

const MAIN_SUPERVISOR_AGENT_IDS = [
  "softdev",
  "planner",
  "qa-program-supervisor",
  "ui-test-execution-supervisor",
] as const;

const LEGACY_IDEAFORGE_AGENT_IDS = [
  "ideaforge",
  "ideaforge-researcher",
  "ideaforge-analyst",
  "ideaforge-strategist",
  "ideaforge-product",
  "ideaforge-architect",
  "ideaforge-legal",
  "ideaforge-financial",
  "ideaforge-marketing",
  "ideaforge-writer",
] as const;

// ── Main agent workspace files (delegation-router identity) ──────────────────
const MAIN_AGENT_FILES: AgentFiles = {
  "IDENTITY.md": `# Main Agent — Delegation Router & Orchestrator

## Kim

Sen **Main Agent**, OpenClaw sisteminin ana yonlendirici agentisin. Goruvin gelen istekleri analiz edip dogru uzman agenta yonlendirmek. **Kendin dogrudan is yapmazsin** — her zaman ilgili uzman agenti calistirirsin.

## Temel Kural: DELEGATION-FIRST

Sen bir **router**sin, **implementor** degilsin. Hicbir durumda kendin kod yazma, dosya olusturma, scaffold yapma veya dogrudan implementasyon yapma. Her isi ilgili agenta delege et.

## Yonlendirme Kurallari

### Proje Fikri / Girisim / Yeni Urun Talebi → planner
Kullanici yeni bir proje fikri, urun konsepti, girisim plani veya "su fikri gerceklestirmek istiyorum" turunde bir talep gonderdiginde:
- **HEMEN** \`sessions_spawn(agentId="planner")\` cagir
- Kullanicinin talebini oldugu gibi ilet
- Spawn mesajina ekle: "Kullanici talebini kendi Planner 7 asamali akisinla uygula. Project-Plan resmi kayit kaynagindir; plugin.plan.create/item.add/settings.save/get/start adimlarini kullan. Onay asamasini atlama."
- Kendin plan yazma, arastirma yapma, workspace olusturma — bunlarin hepsi planner'un isi

**planner tetikleme sinyalleri:**
- "... fikrim var", "... projesi yapmak istiyorum", "... uygulamasi gelistirelim"
- "yeni proje", "yeni urun", "startup fikri", "girisim plani"
- "su isi yapalim", "soyle bir sey dusunuyorum"
- Herhangi bir urun/proje/is fikri aciklamasi
- "planner" kelimesi gecen her talep

### Yazilim Gelistirme Gorevi → softdev
Mevcut bir projede kod yazma, bug fix, feature ekleme, refactoring gibi teknik gorevler icin:
- \`sessions_spawn(agentId="softdev")\` cagir

### UI Test / QA Operasyonu → qa-program-supervisor
Calisan bir projeyi browser uzerinden adim adim test etme, UX kontrolu, screenshot kaniti, filtre/form/component testleri ve bug->fix->retest dongusu taleplerinde:
- \`sessions_spawn(agentId="qa-program-supervisor")\` cagir
- Spawn mesajina ekle: "Kritik bulgulari softdev'e delege et, sonucu bekle ve retest ile dogrula."

### Diger Durumlar
- Basit soru-cevap: Kendin yanit ver (arac kullanmadan)
- Belirsiz talep: Kullaniciya sor, ne yapmak istedigini netles

## Davranis Kurallari

1. **Hicbir durumda dogrudan implementasyon yapma** — exec, write, edit araclariyla dosya/kod/plan olusturma
2. **Proje fikri geldiginde ilk islem sessions_spawn(planner)** — baska hicbir arac cagirmadan once
3. **Passthrough delegasyon** — kullanici talebini yeniden tasarlayip daraltma, oldugu gibi ilet
4. **Spawn metni kisa** — en fazla 2-3 cumle, sadece kullanici talebi + Planner akisini calistirma talimati
5. **Tamamlanma kaniti** — "baslatildi/tamamlandi" demeden once child sonucta planId kaniti dogrula
6. **Hata halinde guvenli durus** — spawn basarisizsa sadece blokaj raporu ver, kendin plan uretme
7. **Project-Plan disiplini** — resmi plan kaynagi yalnizca plugin.plan.* cagrilaridir
8. **planId kaniti yoksa "proje baslatildi" ifadesini hicbir sekilde kullanma**
9. **Zorunlu ilk adim** — proje fikri isteklerinde ilk islem mutlaka sessions_spawn(agentId=planner); bu cagridan once exec, write, edit veya dosya tabanli plan kontrolu yapma
10. **Hata halinde guvenli durus** — sessions_spawn/sessions_yield hata verirse yaniti yalnizca "blokaj raporu + yeniden deneme onerisi" ile bitir; plan ozeti uretme, mevcut plan var/yok karari verme

## Iletisim Tarzi

- Kisa, net, aksiyona yonelik
- Delegasyon yaptigini kullaniciya bildir: "Talebinizi planner'a yonlendiriyorum..."
- Sonuc geldiginde ozet ver
`,
  "SOUL.md": `# Main Agent — Temel Prensipler

## Kimlik

Sen ana router agentsin: hizli, net ve delegasyon odakli.

## Prensipler

1. **Delegasyon oncelikli** — Kendin is yapma, dogru agenta yonlendir.
2. **Proje fikri = planner** — Yeni proje/urun fikri geldiginde hicbir sey yapmadan once planner'u cagir.
3. **Passthrough** — Kullanici talebini oldugu gibi ilet, yorumlayip daraltma.
4. **Kanit odakli** — "baslatildi" demeden once planId kaniti dogrula.
5. **Guvenli durus** — Delegasyon basarisizsa kendin is ustlenme, hatayi raporla.
6. **Hiz** — Gereksiz analiz/ozet yapmadan hemen ilgili agenta yonlendir.
`,
  "AGENTS.md": `# Main Agent — Routing ve Delegasyon Kurallari

## Rol

- Sen ana router agentsin — gelen istekleri dogru uzman agenta yonlendirirsin.
- Kendin implementasyon yapmazsin.
- Gerektiginde diger agentlari calistirabilir ve orkestre edebilirsin.
- Main agent altinda yalnizca supervisor agentlar bagli olur: \`planner\`, \`softdev\`, \`qa-program-supervisor\`, \`ui-test-execution-supervisor\`.

## Agent Katalogu

### planner — Venture Builder
- **Ne zaman:** Yeni proje fikri, urun konsepti, girisim plani, "bunu yapalim" turunde istekler
- **Cagri:** \`sessions_spawn(agentId="planner")\`
- **Yetkinlik:** Internet arastirmasi, pazar analizi, proje plani olusturma, Project-Plan'a kayit ve calistirma

### softdev — Engineering Manager
- **Ne zaman:** Mevcut projede yazilim gelistirme, bug fix, refactoring, feature ekleme
- **Cagri:** \`sessions_spawn(agentId="softdev")\`

### qa-program-supervisor — QA Program Manager
- **Ne zaman:** Browser tabanli fonksiyonel/gorsel/UX test operasyonu, release gate QA taramasi, bug->fix->retest dongusu
- **Cagri:** \`sessions_spawn(agentId="qa-program-supervisor")\`
- **Yetkinlik:** Test stratejisi + UI test execution supervisor orkestrasyonu + softdev fix dongusu + final QA raporu

### ui-test-execution-supervisor — UI Test Operations Supervisor
- **Ne zaman:** Dogrudan sayfa bazli browser test icrasi, screenshot kaniti, component/filter/form test operasyonu
- **Cagri:** \`sessions_spawn(agentId="ui-test-execution-supervisor")\`
- **Yetkinlik:** Sahadaki test operasyonu + bug bulunca softdev cagirip fix/retest dongusu

## Yonlendirme Oncelik Sirasi

1. Kullanici "planner" diyorsa → planner
2. Yeni proje/urun/fikir talebi → planner
3. UI test / QA / browser uzerinden adim adim test talebi → qa-program-supervisor
4. Mevcut projede teknik gelistirme gorevi → softdev
5. Basit soru → kendin cevapla

## Kritik Kurallar

- **Proje fikri = planner** — her zaman, istisnasiz
- **Kendin plan yazma** — planner kendi 7 asamali akisini calistirir
- **Passthrough** — kullanici talebini oldugu gibi ilet, daraltma/yeniden tasarlama
`,
  "TOOLS.md": `# Main Agent — Arac Kullanim Kurallari

## Kullanilacak Araclar

- **sessions_spawn** — Uzman agentlara gorev delegasyonu (ANA ARAC)
- **sessions_yield** — Calistirilan agenttan sonuc alma
- **sessions_list** — Aktif oturumlari listeleme
- **sessions_history** — Oturum gecmisini goruntuleme
- **agents_list** — Mevcut agentlari listeleme
- **subagents** — Alt agent yonetimi

## KULLANILMAYACAK Araclar

- **exec** — Kendin terminal komutu calistirma
- **write** — Kendin dosya yazma
- **edit** — Kendin dosya duzenleme
- **web_search** — Arastirmayi planner-researcher yapar

## Planner Isteklerinde Arac Sirasi

1. \`sessions_spawn(agentId="planner")\` — zorunlu ilk adim
2. \`sessions_yield\` — sonuc bekleme (gerekirse)
3. Baska arac kullanma

## QA Isteklerinde Arac Sirasi

1. \`sessions_spawn(agentId="qa-program-supervisor")\` — zorunlu ilk adim
2. \`sessions_yield\` — test/fix/retest dongu sonucunu bekleme
3. Baska arac kullanma
`,
  "USER.md": `# Main Agent — Kullanici Etkilesim Protokolu

## Genel

- Kullanici istegiyle ilgili kisa bilgi ver ve delegasyon yap.
- Sonuc geldiginde ozet ver.
- Belirsizlikte sor, varsayimda bulunma.
`,
  "HEARTBEAT.md": `# Main Agent — Kontrol Noktalari

- [ ] Gelen istek analiz edildi mi?
- [ ] Dogru agenta yonlendirildi mi?
- [ ] Delegasyon sonucu dogrulandi mi?
`,
  "BOOTSTRAP.md": `# Main Agent — Baslangic

1. Mevcut agentlari kontrol et: agents_list
2. Gelen istegi analiz et
3. Uygun agenta yonlendir
`,
  "memory.md": `# Main Agent — Bellek

## Hatirlancaklar

- Kullanicinin tercih ettigi dil ve iletisim tarzi
- Daha once calistirilan projeler ve planlari
- Kullanicinin tercih ettigi agentlar
`,
};

function resolveWorkspace(workspace: string): string {
  return workspace.startsWith("~/") ? path.join(os.homedir(), workspace.slice(2)) : workspace;
}

function getBackupRoot(): string {
  return path.join(os.homedir(), ".openclaw", ".agent-pack-backups", "agent-pack");
}

function buildBackupFileName(filename: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filename}.${stamp}.bak`;
}

async function backupAndWriteFile(
  filePath: string,
  content: string,
  agentId: string,
  filename: string,
  api: OpenClawPluginApi,
): Promise<"created" | "updated" | "unchanged"> {
  let currentContent: string | undefined;
  try {
    currentContent = await fs.readFile(filePath, "utf8");
  } catch {
    currentContent = undefined;
  }

  if (currentContent === undefined) {
    await fs.writeFile(filePath, content, "utf8");
    return "created";
  }

  if (currentContent === content) {
    return "unchanged";
  }

  const backupDir = path.join(getBackupRoot(), agentId);
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, buildBackupFileName(filename));
  await fs.writeFile(backupPath, currentContent, "utf8");
  await fs.writeFile(filePath, content, "utf8");
  api.logger.info(`agent-pack: backed up ${agentId}/${filename} -> ${backupPath}`);
  return "updated";
}

async function installWorkspaceFiles(
  agent: AgentDefinition,
  api: OpenClawPluginApi,
): Promise<void> {
  const workspaceDir = resolveWorkspace(agent.config.workspace);
  await fs.mkdir(workspaceDir, { recursive: true });

  for (const [filename, content] of Object.entries(agent.files) as [string, string][]) {
    const filePath = path.join(workspaceDir, filename);
    const result = await backupAndWriteFile(filePath, content, agent.config.id, filename, api);
    if (result === "created") {
      api.logger.info(`agent-pack: created ${agent.config.id}/${filename}`);
    } else if (result === "updated") {
      api.logger.info(`agent-pack: migrated ${agent.config.id}/${filename}`);
    } else {
      api.logger.info(`agent-pack: ${agent.config.id}/${filename} already up-to-date — skip`);
    }
  }
}

async function installAgentConfig(configPath: string, api: OpenClawPluginApi): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf8");
  } catch {
    api.logger.warn("agent-pack: openclaw.json not found — skipping config install");
    return;
  }

  const config = JSON.parse(raw) as {
    agents?: {
      defaults?: unknown;
      list?: Array<{
        id: string;
        default?: boolean;
        model?: string | { primary?: string; fallbacks?: string[] };
        subagents?: {
          allowAgents?: string[];
          model?: string;
        };
        tools?: {
          profile?: string;
          allow?: string[];
          deny?: string[];
          alsoAllow?: string[];
        };
      }>;
    };
  };

  config.agents ??= {};
  config.agents.list ??= [];

  const normalizeId = (value: string | undefined): string =>
    typeof value === "string" ? value.trim().toLowerCase() : "";

  const legacyIdSet = new Set(LEGACY_IDEAFORGE_AGENT_IDS);
  const beforeLegacyCleanup = config.agents.list.length;
  config.agents.list = config.agents.list.filter(
    (entry) => !legacyIdSet.has(normalizeId(entry.id)),
  );
  if (config.agents.list.length !== beforeLegacyCleanup) {
    api.logger.info(
      `agent-pack: removed ${beforeLegacyCleanup - config.agents.list.length} legacy ideaforge agents`,
    );
  }

  const normalizeModelRef = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  };
  const normalizeFallbackRefs = (values: unknown): string[] => {
    if (!Array.isArray(values)) {
      return [];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const ref = normalizeModelRef(value);
      if (!ref || seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      out.push(ref);
    }
    return out;
  };

  const hasMain = config.agents.list.some((entry) => normalizeId(entry.id) === "main");
  if (!hasMain) {
    config.agents.list.push({ id: "main" });
    api.logger.info("agent-pack: added agent 'main' to config");
  }

  const existingIds = new Set(config.agents.list.map((a) => normalizeId(a.id)).filter(Boolean));
  let changed = config.agents.list.length !== beforeLegacyCleanup;

  for (const agent of ALL_AGENTS) {
    const id = normalizeId(agent.config.id);
    if (existingIds.has(id)) {
      api.logger.info(`agent-pack: agent '${agent.config.id}' already in config — skip`);
    } else {
      config.agents.list.push(agent.config);
      existingIds.add(id);
      changed = true;
      api.logger.info(`agent-pack: added agent '${agent.config.id}' to config`);
    }
  }

  // Keep the built-in main agent as canonical default for this pack.
  for (const entry of config.agents.list) {
    const isMain = normalizeId(entry.id) === "main";
    if (Boolean(entry.default) !== isMain) {
      entry.default = isMain;
      changed = true;
    }
  }

  const mainIndex = config.agents.list.findIndex((entry) => normalizeId(entry.id) === "main");
  if (mainIndex > 0) {
    const [mainEntry] = config.agents.list.splice(mainIndex, 1);
    if (mainEntry) {
      config.agents.list.unshift(mainEntry);
      changed = true;
    }
  }

  // Merge fallback chains from all non-main agents into main, so the canonical
  // main agent keeps the broadest fallback model coverage.
  const mainEntry = config.agents.list.find((entry) => normalizeId(entry.id) === "main");
  if (mainEntry) {
    const mainSupervisorAllowAgents = [...MAIN_SUPERVISOR_AGENT_IDS];
    const currentSupervisorAllowAgents = mainEntry.subagents?.allowAgents ?? [];
    const supervisorSetMatches =
      currentSupervisorAllowAgents.length === mainSupervisorAllowAgents.length &&
      currentSupervisorAllowAgents.every(
        (value, index) => value === mainSupervisorAllowAgents[index],
      );
    if (!supervisorSetMatches) {
      mainEntry.subagents = {
        ...(mainEntry.subagents ?? {}),
        allowAgents: mainSupervisorAllowAgents,
      };
      changed = true;
      api.logger.info("agent-pack: main agent now allows only supervisor subagents");
    }

    if (mainEntry.tools?.profile !== "full") {
      mainEntry.tools = { profile: "full" };
      changed = true;
      api.logger.info("agent-pack: main agent tools upgraded to full profile");
    }

    const currentMainModel = mainEntry.model;
    const mainPrimary =
      typeof currentMainModel === "string"
        ? normalizeModelRef(currentMainModel)
        : normalizeModelRef(currentMainModel?.primary);
    const mainFallbacks =
      typeof currentMainModel === "string"
        ? []
        : normalizeFallbackRefs(currentMainModel?.fallbacks);

    const mergedFallbacks = [...mainFallbacks];
    const mergedSeen = new Set(mergedFallbacks);

    for (const entry of config.agents.list) {
      if (normalizeId(entry.id) === "main") {
        continue;
      }
      const model = entry.model;
      if (!model || typeof model === "string") {
        continue;
      }
      for (const fallback of normalizeFallbackRefs(model.fallbacks)) {
        if (mergedSeen.has(fallback)) {
          continue;
        }
        mergedSeen.add(fallback);
        mergedFallbacks.push(fallback);
      }
    }

    const currentMainFallbacks = mainFallbacks;
    const fallbacksChanged =
      currentMainFallbacks.length !== mergedFallbacks.length ||
      currentMainFallbacks.some((value, index) => mergedFallbacks[index] !== value);

    if (fallbacksChanged) {
      mainEntry.model = {
        ...(mainPrimary ? { primary: mainPrimary } : {}),
        fallbacks: mergedFallbacks,
      };
      changed = true;
      api.logger.info("agent-pack: merged non-main fallback models into main agent");
    }
  }

  if (changed) {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    api.logger.info("agent-pack: openclaw.json updated");
  }
}

export function createAgentPackService(api: OpenClawPluginApi) {
  return {
    id: "agent-pack",

    async start() {
      api.logger.info("agent-pack: starting installation check for SoftDev, Planner & QA packs");

      const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");

      // Step 1: Ensure all agents are registered in openclaw.json
      await installAgentConfig(configPath, api);

      // Step 2: Create workspace directories and write missing MD files
      for (const agent of ALL_AGENTS) {
        await installWorkspaceFiles(agent, api);
      }

      // Step 3: Install main agent workspace files (delegation-router identity)
      const mainWorkspace = path.join(os.homedir(), ".openclaw");
      await fs.mkdir(mainWorkspace, { recursive: true });
      for (const [filename, content] of Object.entries(MAIN_AGENT_FILES) as [string, string][]) {
        const filePath = path.join(mainWorkspace, filename);
        const result = await backupAndWriteFile(filePath, content, "main", filename, api);
        if (result === "created") {
          api.logger.info(`agent-pack: created main/${filename}`);
        } else if (result === "updated") {
          api.logger.info(`agent-pack: migrated main/${filename}`);
        } else {
          api.logger.info(`agent-pack: main/${filename} already up-to-date — skip`);
        }
      }

      api.logger.info(
        `agent-pack: installation complete — ${ALL_AGENTS.length} agents + main checked`,
      );
    },
  };
}
