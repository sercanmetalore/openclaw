import type { Api, Model } from "@mariozechner/pi-ai";
import { normalizeModelCompat } from "../model-compat.js";
import { normalizeProviderId } from "../model-selection.js";

function isOpenAIApiBaseUrl(baseUrl?: string): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  return /^https?:\/\/api\.openai\.com(?:\/v1)?\/?$/i.test(trimmed);
}

function normalizeGitHubCopilotTransport(params: {
  provider: string;
  model: Model<Api>;
}): Model<Api> {
  if (normalizeProviderId(params.provider) !== "github-copilot") {
    return params.model;
  }

  if (params.model.api !== "github-copilot") {
    return params.model;
  }

  const normalizedModelId = params.model.id.trim().toLowerCase();
  let api: Api = "openai-completions";

  if (normalizedModelId.includes("claude")) {
    api = "anthropic-messages";
  } else if (normalizedModelId.includes("codex")) {
    api = "openai-codex-responses";
  } else if (normalizedModelId.startsWith("gpt-5")) {
    api = "openai-responses";
  }

  return {
    ...params.model,
    api,
  } as Model<Api>;
}

function normalizeOpenAITransport(params: { provider: string; model: Model<Api> }): Model<Api> {
  if (normalizeProviderId(params.provider) !== "openai") {
    return params.model;
  }

  const useResponsesTransport =
    params.model.api === "openai-completions" &&
    (!params.model.baseUrl || isOpenAIApiBaseUrl(params.model.baseUrl));

  if (!useResponsesTransport) {
    return params.model;
  }

  return {
    ...params.model,
    api: "openai-responses",
  } as Model<Api>;
}

export function applyBuiltInResolvedProviderTransportNormalization(params: {
  provider: string;
  model: Model<Api>;
}): Model<Api> {
  const githubCopilotNormalized = normalizeGitHubCopilotTransport(params);
  return normalizeOpenAITransport({
    ...params,
    model: githubCopilotNormalized,
  });
}

export function normalizeResolvedProviderModel(params: {
  provider: string;
  model: Model<Api>;
}): Model<Api> {
  return normalizeModelCompat(applyBuiltInResolvedProviderTransportNormalization(params));
}
