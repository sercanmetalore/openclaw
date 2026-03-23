// ── Agent Pack Types ──────────────────────────────────────────────────────────

export type AgentConfig = {
  id: string;
  name?: string;
  workspace: string;
  identity?: {
    name?: string;
    theme?: string;
    emoji?: string;
  };
  subagents?: {
    allowAgents?: string[];
    model?: string;
  };
  sandbox?: {
    perSession?: boolean;
  };
  tools?: {
    profile?: string;
    allow?: string[];
    deny?: string[];
    alsoAllow?: string[];
  };
};

export type AgentFiles = {
  "IDENTITY.md": string;
  "SOUL.md": string;
  "AGENTS.md": string;
  "TOOLS.md": string;
  "USER.md": string;
  "HEARTBEAT.md": string;
  "BOOTSTRAP.md": string;
  "memory.md": string;
};

export type AgentDefinition = {
  config: AgentConfig;
  files: AgentFiles;
};
