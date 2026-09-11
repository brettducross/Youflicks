import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header";
import { getSession } from "@/server/auth/session";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "AI processing notice (draft)",
  description:
    "Draft placeholder for YouFlicks third-party AI processing terms. Not counsel-approved.",
  robots: { index: false, follow: false },
};

/**
 * Public draft route the consent banner can link. Body is intentionally not
 * legal copy — Product Owner / counsel fill docs/BETA_AI_CONSENT_COPY_TEMPLATE.md
 * then bump AI_CONSENT_POLICY_VERSION.
 */
export default async function AiProcessingDraftPage() {
  const session = await getSession();
  const policyVersion = env.AI_CONSENT_POLICY_VERSION;

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader signedIn={Boolean(session?.user)} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">
        <p className="text-xs font-medium tracking-[0.28em] text-primary uppercase">
          Draft — not counsel-approved
        </p>
        <h1 className="mt-3 text-4xl text-balance">AI processing notice</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Policy version <span className="font-mono text-foreground">{policyVersion}</span>.
          This page is a placeholder so the in-app consent banner has a stable URL.
          It is not a privacy policy, DPA, or Terms of Service.
        </p>
        <div className="mt-8 space-y-4 text-sm leading-6">
          <p>
            YouFlicks closed beta may send photos, video frames, or transcripts to
            configured third-party AI processors for analysis or generation. Exact
            processor names, purpose, retention, and withdrawal steps will be
            published here after Product Owner / counsel fill the in-repo template.
          </p>
          <p>
            Constitution stance that must remain honest in the published copy:
            YouFlicks does not train on customer footage by default. Until counsel
            supplies wording, treat the in-app banner as a legal placeholder and
            do not treat this page as permission to mint invites.
          </p>
          <p className="text-muted-foreground">
            Required clauses (still blanks for counsel): third-party processors,
            purpose, never-train-by-default, retention (best-effort), how to
            withdraw. Template:{" "}
            <span className="font-mono">docs/BETA_AI_CONSENT_COPY_TEMPLATE.md</span>
          </p>
        </div>
        <p className="mt-10 text-sm text-muted-foreground">
          <Link href="/" className="text-primary underline-offset-4 hover:underline">
            Back to YouFlicks
          </Link>
        </p>
      </main>
    </div>
  );
}
