import type { MediaAnalysisView } from "@/lib/media-types";

type AnalysisDoc = {
  analysisSchemaVersion?: string;
  technical?: {
    mimeType?: string;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    orientation?: string;
  };
  visual?: {
    sceneDescription?: string;
    objects?: string[];
    environments?: string[];
    locations?: string[];
    activities?: string[];
    visualQuality?: string;
    composition?: string;
  };
  people?: { count?: number };
  audio?: { present?: boolean; speechPresent?: boolean; transcript?: string };
  moments?: Array<{ startMs: number; endMs: number; description?: string }>;
  quality?: { overall?: number; technicallyUsable?: boolean };
};

function chips(values?: string[]) {
  if (!values?.length) return null;
  return values.join(", ");
}

export function AnalysisDetails({ inspection }: { inspection: MediaAnalysisView }) {
  const doc = (inspection.analysis ?? {}) as AnalysisDoc;
  const rows: Array<{ label: string; value: string }> = [];

  if (doc.technical?.mimeType) {
    rows.push({
      label: "Technical",
      value: [
        doc.technical.mimeType,
        doc.technical.width && doc.technical.height
          ? `${doc.technical.width}×${doc.technical.height}`
          : null,
        doc.technical.orientation,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (doc.visual?.sceneDescription) {
    rows.push({ label: "Scene", value: doc.visual.sceneDescription });
  }
  if (chips(doc.visual?.objects)) {
    rows.push({ label: "Objects", value: chips(doc.visual?.objects)! });
  }
  if (chips(doc.visual?.environments)) {
    rows.push({ label: "Environment", value: chips(doc.visual?.environments)! });
  }
  if (chips(doc.visual?.locations)) {
    rows.push({ label: "Location", value: chips(doc.visual?.locations)! });
  }
  if (doc.visual?.visualQuality) {
    rows.push({ label: "Visual quality", value: doc.visual.visualQuality });
  }
  if (chips(doc.visual?.activities)) {
    rows.push({ label: "Activities", value: chips(doc.visual?.activities)! });
  }
  if (doc.visual?.composition) {
    rows.push({ label: "Composition", value: doc.visual.composition });
  }
  if (typeof doc.people?.count === "number") {
    rows.push({ label: "People", value: String(doc.people.count) });
  }
  if (typeof doc.audio?.present === "boolean") {
    rows.push({
      label: "Audio",
      value: [
        doc.audio.present ? "present" : "none",
        doc.audio.speechPresent ? "speech" : null,
        doc.audio.transcript ? "transcript available" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (doc.moments?.length) {
    rows.push({ label: "Moments", value: `${doc.moments.length} marked` });
  }
  if (typeof doc.quality?.overall === "number") {
    rows.push({
      label: "Quality",
      value: `${doc.quality.overall}${
        typeof doc.quality.technicallyUsable === "boolean"
          ? doc.quality.technicallyUsable
            ? " · usable"
            : " · limited"
          : ""
      }`,
    });
  }

  return (
    <div className="max-h-64 overflow-auto border-t border-border/60 bg-muted/30 p-4">
      {rows.length > 0 ? (
        <dl className="grid gap-2 text-sm">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs tracking-widest text-muted-foreground uppercase">
                {row.label}
              </dt>
              <dd className="mt-0.5">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          Normalized analysis is stored. No extra visual notes were supplied.
        </p>
      )}
      <p className="mt-3 text-[11px] tracking-wide text-muted-foreground uppercase">
        Schema {inspection.schemaVersion}
        {inspection.modelId ? ` · model ${inspection.modelId}` : ""}
        {inspection.providerKey ? ` · source ${inspection.providerKey}` : ""}
      </p>
    </div>
  );
}
