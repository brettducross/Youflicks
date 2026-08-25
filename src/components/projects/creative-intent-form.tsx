"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CreativeIntentView, EffectiveCreativeBrief } from "@/server/personalization/views";

export function CreativeIntentForm({
  projectId,
  initialIntent,
  initialEffective,
}: {
  projectId: string;
  initialIntent: CreativeIntentView;
  initialEffective: EffectiveCreativeBrief;
}) {
  const [purpose, setPurpose] = useState(initialIntent.purpose ?? "");
  const [audience, setAudience] = useState(initialIntent.audience ?? "");
  const [mood, setMood] = useState(initialIntent.mood ?? "");
  const [duration, setDuration] = useState(
    initialIntent.desiredDurationMs ? String(Math.round(initialIntent.desiredDurationMs / 1000)) : "",
  );
  const [visualStyle, setVisualStyle] = useState(initialIntent.visualStyle ?? "");
  const [musicStyle, setMusicStyle] = useState(initialIntent.musicStyle ?? "");
  const [narrativeStyle, setNarrativeStyle] = useState(initialIntent.narrativeStyle ?? "");
  const [instructions, setInstructions] = useState(initialIntent.explicitInstructions ?? "");
  const [effective, setEffective] = useState(initialEffective);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    try {
      const seconds = duration.trim() ? Number(duration) : null;
      const res = await fetch(`/api/projects/${projectId}/intent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: purpose || null,
          audience: audience || null,
          mood: mood || null,
          desiredDurationMs: seconds ? Math.round(seconds * 1000) : null,
          visualStyle: visualStyle || null,
          musicStyle: musicStyle || null,
          narrativeStyle: narrativeStyle || null,
          explicitInstructions: instructions || null,
        }),
      });
      const body = (await res.json()) as {
        error?: { message?: string };
        effective?: EffectiveCreativeBrief;
      };
      if (!res.ok) {
        throw new Error(body.error?.message ?? "Could not save intent.");
      }
      if (body.effective) setEffective(body.effective);
      toast.success("Project intent saved. It wins over your usual taste for this film.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save intent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        This film can differ from your usual taste. Project intent wins here.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Purpose" value={purpose} onChange={setPurpose} placeholder="Birthday recap" />
        <Field label="Audience" value={audience} onChange={setAudience} placeholder="Family" />
        <Field label="Mood" value={mood} onChange={setMood} placeholder="Funny and fast" />
        <Field label="Target length (seconds)" value={duration} onChange={setDuration} placeholder="90" />
        <Field label="Visual style" value={visualStyle} onChange={setVisualStyle} placeholder="Handheld, bright" />
        <Field label="Music style" value={musicStyle} onChange={setMusicStyle} placeholder="Upbeat pop" />
      </div>
      <Field label="Narrative style" value={narrativeStyle} onChange={setNarrativeStyle} placeholder="Montage" />
      <div className="grid gap-2">
        <Label htmlFor="instructions">Explicit instructions</Label>
        <Textarea
          id="instructions"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Keep grandma in the first minute. Do not make it cinematic and slow."
          rows={3}
        />
      </div>
      {effective.overriddenByProject.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Overriding taste for: {effective.overriddenByProject.join(", ")}.
        </p>
      ) : null}
      <div>
        <Button type="button" disabled={pending} onClick={() => void save()} className="h-9">
          {pending ? "Saving…" : "Save project intent"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  );
}
