import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { STORY_DOCUMENT_SCHEMA_VERSION } from "@/server/story/schema";
import { validateStoryDocument } from "@/server/story/validate";

function validDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
    title: "Harbor afternoon",
    logline: "A family finds its way back to the water.",
    spine: {
      opening: "Arrive at the harbor.",
      development: "The day unfolds.",
      resolution: "They leave together.",
    },
    acts: [
      {
        id: "act-1",
        order: 0,
        title: "Opening",
        purpose: "Establish place.",
        targetDurationMs: 30_000,
        scenes: [
          {
            id: "scene-1",
            order: 0,
            title: "Arrival",
            purpose: "Step onto the dock.",
            dramaticFunction: "exposition",
            mediaRoles: [{ role: "establishing_visual", purpose: "Harbor wide." }],
          },
        ],
      },
    ],
    source: {
      creativePlanId: "plan_1",
      creativePlanVersion: 1,
    },
    ...overrides,
  };
}

describe("StoryDocument schema v1", () => {
  it("requires the YouFlicks schema version and locked field tree", () => {
    expect(() => validateStoryDocument({ title: "Nope" })).toThrow(AppError);
    const document = validateStoryDocument(validDocument());
    expect(document.schemaVersion).toBe("1.0");
    expect(document.acts[0]?.targetDurationMs).toBe(30_000);
  });

  it("rejects startMs/endMs, clip lists, tracks, transitions, render, and host JSON", () => {
    expect(() =>
      validateStoryDocument(
        validDocument({
          startMs: 0,
          endMs: 1000,
        }),
      ),
    ).toThrow(/timing|schema/i);

    expect(() =>
      validateStoryDocument(
        validDocument({
          clips: [{ id: "clip-1" }],
        }),
      ),
    ).toThrow(AppError);

    expect(() =>
      validateStoryDocument(
        validDocument({
          acts: [
            {
              id: "act-1",
              order: 0,
              purpose: "x",
              scenes: [
                {
                  id: "scene-1",
                  order: 0,
                  purpose: "x",
                  dramaticFunction: "exposition",
                  mediaRoles: [],
                  startMs: 12,
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/timing|schema/i);
  });

  it("rejects document-level targetDurationMs and scene-level targetDurationMs", () => {
    expect(() => validateStoryDocument(validDocument({ targetDurationMs: 90_000 }))).toThrow(
      AppError,
    );
    expect(() =>
      validateStoryDocument(
        validDocument({
          acts: [
            {
              id: "act-1",
              order: 0,
              purpose: "x",
              scenes: [
                {
                  id: "scene-1",
                  order: 0,
                  purpose: "x",
                  dramaticFunction: "exposition",
                  mediaRoles: [],
                  targetDurationMs: 4000,
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/acts only|timing/i);
  });

  it("rejects unknown dramaticFunction values", () => {
    expect(() =>
      validateStoryDocument(
        validDocument({
          acts: [
            {
              id: "act-1",
              order: 0,
              purpose: "x",
              scenes: [
                {
                  id: "scene-1",
                  order: 0,
                  purpose: "x",
                  dramaticFunction: "smash_cut",
                  mediaRoles: [],
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(AppError);
  });
});
