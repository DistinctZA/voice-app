import type { EngineType, ModelInfo } from "@/bindings";

/** Models shown in onboarding and settings (Parakeet + Whisper lineup). */
export const CATALOG_ENGINE_TYPES: EngineType[] = ["Parakeet", "Whisper"];

export function isCatalogModel(model: ModelInfo): boolean {
  return CATALOG_ENGINE_TYPES.includes(model.engine_type);
}

/** Least accurate → most accurate; custom models last. */
export function compareModelsByQuality(a: ModelInfo, b: ModelInfo): number {
  if (a.is_custom !== b.is_custom) {
    return a.is_custom ? 1 : -1;
  }
  if (a.accuracy_score !== b.accuracy_score) {
    return a.accuracy_score - b.accuracy_score;
  }
  return a.speed_score - b.speed_score;
}

export function sortModelsByQuality(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort(compareModelsByQuality);
}
