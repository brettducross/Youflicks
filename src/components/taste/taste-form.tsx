"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TasteDimension, TasteOrigin, TasteSignalKind, WHAT_MATTERS_OPTIONS } from "@/server/domain/personalization";
import type { SponsorshipPreferenceView, TasteProfileView } from "@/server/personalization/views";
import { cn } from "@/lib/utils";

function valuesFor(profile: TasteProfileView, dimension: string) {
  return profile.preferences.filter((item) => item.dimension === dimension).map((item) => item.value);
}

export function TasteForm({
  initialProfile,
  initialSponsorship,
}: {
  initialProfile: TasteProfileView;
  initialSponsorship: SponsorshipPreferenceView;
}) {
  const [movies, setMovies] = useState(valuesFor(initialProfile, TasteDimension.FAVORITE_FILMS).join("\n"));
  const [kind, setKind] = useState(valuesFor(initialProfile, TasteDimension.GENRES).join(", "));
  const [matters, setMatters] = useState(valuesFor(initialProfile, TasteDimension.WHAT_MATTERS));
  const [notes, setNotes] = useState(initialProfile.notes ?? "");
  const [prefs, setPrefs] = useState(initialSponsorship);
  const [pending, setPending] = useState(false);

  function toggleMatter(option: string) {
    setMatters((current) =>
      current.includes(option) ? current.filter((item) => item !== option) : [...current, option],
    );
  }

  async function save() {
    setPending(true);
    try {
      const preferences = [
        ...movies
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter(Boolean)
          .map((value) => ({ dimension: TasteDimension.FAVORITE_FILMS, value })),
        ...kind
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .map((value) => ({ dimension: TasteDimension.GENRES, value })),
        ...matters.map((value) => ({ dimension: TasteDimension.WHAT_MATTERS, value })),
      ];

      const tasteRes = await fetch("/api/me/taste", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, preferences }),
      });
      if (!tasteRes.ok) {
        const body = (await tasteRes.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not save taste.");
      }

      for (const movie of movies.split(/\n|,/).map((item) => item.trim()).filter(Boolean)) {
        await fetch("/api/me/taste/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: TasteSignalKind.USER_SELECTED_MOVIE,
            origin: TasteOrigin.EXPLICIT,
            payload: { title: movie },
          }),
        });
      }
      for (const value of matters) {
        await fetch("/api/me/taste/signals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: TasteSignalKind.USER_SELECTED_STYLE,
            origin: TasteOrigin.EXPLICIT,
            payload: { dimension: TasteDimension.WHAT_MATTERS, value },
          }),
        });
      }

      const prefRes = await fetch("/api/me/sponsorship-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!prefRes.ok) {
        throw new Error("Could not save presentation preferences.");
      }

      toast.success("Taste saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save taste.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8">
      <div className="grid gap-2">
        <Label htmlFor="movies">What movies do you love?</Label>
        <Textarea
          id="movies"
          value={movies}
          onChange={(event) => setMovies(event.target.value)}
          placeholder={"One film per line\nThe Apartment\nMoonlight"}
          rows={4}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="kind">What kind of films do you usually enjoy?</Label>
        <Input
          id="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          placeholder="Slow-burn drama, home movies, documentaries"
        />
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">What matters most?</p>
        <div className="flex flex-wrap gap-2">
          {WHAT_MATTERS_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={matters.includes(option) ? "default" : "outline"}
              onClick={() => toggleMatter(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="notes">Anything else we should remember?</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="I like quiet openings and music that feels analog."
          rows={3}
        />
      </div>
      <details className="rounded-xl border border-border/60 p-4">
        <summary className="cursor-pointer text-sm font-medium">After the film (optional)</summary>
        <p className="mt-2 text-sm text-muted-foreground">
          Off by default. Sponsors never see this profile, your footage, or your analysis.
        </p>
        <div className="mt-3 grid gap-2">
          {(
            [
              ["allowSponsorCredits", "Allow sponsor names in credits"],
              ["allowSponsoredEndCard", "Allow a sponsored end card"],
              ["allowVideoAds", "Allow video ads after the film"],
              ["allowPersonalizedSponsoring", "Allow personalized sponsoring"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs[key]}
                onChange={(event) => setPrefs((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      <div>
        <Button type="button" disabled={pending} onClick={() => void save()} className={cn("h-9")}>
          {pending ? "Saving…" : "Save taste"}
        </Button>
      </div>
    </div>
  );
}
