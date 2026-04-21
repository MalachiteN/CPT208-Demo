import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Prompt Service
 *
 * Loads system prompt markdown files from disk and caches them.
 * Prompt files are expected at:
 *   prompts/roleplay-system.md
 *   prompts/hint-system.md
 *   prompts/summary-system.md
 *
 * The cache is populated on first access and reused thereafter.
 * Call reload() to re-read from disk (useful during development).
 */

interface PromptCache {
  roleplay: string | null;
  hint: string | null;
  summary: string | null;
}

const cache: PromptCache = {
  roleplay: null,
  hint: null,
  summary: null,
};

function resolvePromptPath(filename: string): string {
  return resolve(process.cwd(), "prompts", filename);
}

function loadPromptFile(filename: string): string {
  const filePath = resolvePromptPath(filename);
  if (!existsSync(filePath)) {
    console.warn(`[prompt-service] Prompt file not found: ${filePath}`);
    return "";
  }
  return readFileSync(filePath, "utf-8");
}

export function getRoleplayPrompt(): string {
  if (cache.roleplay === null) {
    cache.roleplay = loadPromptFile("roleplay-system.md");
  }
  return cache.roleplay;
}

export function getHintPrompt(): string {
  if (cache.hint === null) {
    cache.hint = loadPromptFile("hint-system.md");
  }
  return cache.hint;
}

export function getSummaryPrompt(): string {
  if (cache.summary === null) {
    cache.summary = loadPromptFile("summary-system.md");
  }
  return cache.summary;
}

export function reload(): void {
  cache.roleplay = null;
  cache.hint = null;
  cache.summary = null;
}

export const PromptService = {
  getRoleplayPrompt,
  getHintPrompt,
  getSummaryPrompt,
  reload,
};

export default PromptService;
