import { TasteDimension } from "@/server/domain/personalization";
import type {
  CreativeIntentView,
  EffectiveCreativeBrief,
  TasteProfileView,
} from "@/server/personalization/views";

function firstValue(profile: TasteProfileView | null, dimension: string) {
  return profile?.preferences.find((item) => item.dimension === dimension)?.value ?? null;
}

function allValues(profile: TasteProfileView | null, dimension: string) {
  return (
    profile?.preferences.filter((item) => item.dimension === dimension).map((item) => item.value) ??
    []
  );
}

/**
 * Project intent wins whenever it is set. Taste fills only the gaps.
 * A future AI Director must consume this brief — not a vendor prompt dump.
 */
export function resolveEffectiveCreativeBrief(
  taste: TasteProfileView | null,
  intent: CreativeIntentView | null,
): EffectiveCreativeBrief {
  const overriddenByProject: string[] = [];
  const pick = (field: string, intentValue: string | null | undefined, tasteValue: string | null) => {
    if (intentValue && intentValue.trim()) {
      overriddenByProject.push(field);
      return intentValue;
    }
    return tasteValue;
  };

  return {
    purpose: intent?.purpose ?? null,
    audience: intent?.audience ?? null,
    mood: pick("mood", intent?.mood, firstValue(taste, TasteDimension.EMOTIONAL)),
    desiredDurationMs: intent?.desiredDurationMs ?? null,
    narrativeStyle: pick(
      "narrativeStyle",
      intent?.narrativeStyle,
      firstValue(taste, TasteDimension.NARRATIVE),
    ),
    visualStyle: pick(
      "visualStyle",
      intent?.visualStyle,
      firstValue(taste, TasteDimension.VISUAL_STYLE),
    ),
    musicStyle: pick("musicStyle", intent?.musicStyle, firstValue(taste, TasteDimension.MUSIC_STYLE)),
    pacing: firstValue(taste, TasteDimension.PACING),
    whatMatters: allValues(taste, TasteDimension.WHAT_MATTERS),
    explicitInstructions: intent?.explicitInstructions ?? null,
    overriddenByProject,
  };
}
