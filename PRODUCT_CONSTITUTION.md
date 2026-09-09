# YouFlicks Product Constitution
**Status:** Binding Product Owner lock (Brett — 2026-09-09)  
**Baseline:** origin/main `d8d521bca5c3944ca30cd17d5ee8154fc1e1c27d` (M7 CLOSED)  
**Stage:** Post-M7 Automation Stage 1 — Constitution + M8 architecture only (no M8 implementation)

This document is the Product Owner constitution for autonomous Chief / Architect / Engineer operation after M3–M7. It supersedes the CoS calibration draft where they conflict.

---

## 1. Core product
YouFlicks turns **real footage + a simple description** into a finished, watchable movie **without making the user become an editor**.

**Primary customer:** Parents / Families. Creators later.

**#1 problem:** Meaningful media piles with no easy path to a coherent emotional movie without professional tools.

**Wow:** Intentional film — story → cut → filled gaps → render → watch → keep → share — **not** a random slideshow.

## 2. Core UX
Workflow: Start a movie → upload + brief → AI creates movie → review → keep/share.  
**3–5** user-visible steps. **Automatic with optional control.**  
Natural-language intent required. NL revision eventually via **recomposition**, not mandatory timeline manipulation.

## 3. Creative principles
AI Director: strong authority; user can override. User-stated style wins; YouFlicks quality bar always.  
Styles: Cinematic, Documentary, Family, Funny, Emotional, Adventure.  
Lengths: Short 1–2 · Normal 3–7 · Long 8–15 min (user may specify; AI default OK).  
Footage priority: intent → story/emotion → faces → quality → chronology. Downrank poor material; **never destroy originals** for quality.

## 4. Permanent architecture principles
Provider neutrality permanent.  
Chain: CreativePlan → StoryStructure → Timeline → GeneratedAsset → Render → Playback → FinishedMovie → Publication.  
Providers = adapters. VLC behind PlaybackPort only. GeneratedAsset ≠ MediaAsset. No NLE creep.  
**Billing / ads / quotas / entitlements never own creative meaning.**  
Do not modify existing PHASE locks to ease M8. No obsolete 2G–2I salvage.

## 5. Commercial model (three complementary access models)
### A. Free ad-supported (confirmed)
Valid email required.  
- 1 free movie generation / hour  
- Max 5-minute movie  
- Watermarked output  
- Advertising enabled  
Free movie must be **genuine usable YouFlicks movie**, not a crippled demo.  
Allowance = **entitlement/credit/usage rule**, not creative-pipeline special cases. Enforce without changing Director creative decisions.

### B. Subscription (primary commercial)
May include higher usage, longer movies, reduced/removed watermark/ads, storage, capacity, priority, premium capabilities. Exact plans = Product Owner later.

### C. Prepaid pay-to-play
Credits / prepaid usage for non-subscribers. Exact economics = Product Owner later.

## 6. Advertising / engine economics
Ads/sponsorship may subsidize engine usage. YouFlicks retains creative control.  
Provider identity may appear on commercial surfaces — **never** let sponsor/engine control CreativePlan/Story/Timeline or inject ads into the movie unless PO explicitly creates that feature later.  
Advertiser concepts **architecturally separate** from creative intelligence.

## 7–13. AI / Generated media / Editing / Family / Library / Sharing / Privacy
As locked in Stage 1 brief: provider auto-select eventually; generated media aspire to pro quality with honesty; own-footage-only mode; regenerate components; intent-first editing (NLE optional never core); family accounts later; library core; download/share with revoke; user owns footage; private by default; **never train on customer footage by default**; local processing important eventually.

## 14. Priority hierarchy
1 Original vision · 2 Movie quality · 3 Simpler UX · 4 Better engineering · 5 Speed · 6 Lower cost

## 15–16. Launch / Platform
Quiet small-group beta ~20–100; family/friends + parents. Web + Windows first; primary Web; later macOS/iOS/Android. Domain platform-neutral.

## 17–18. Must-haves / Never become
Include free tier, subscription, prepaid, ad-supported economics alongside M3–M7 engine must-haves.  
Never: NLE-first, social network, single-vendor wrapper, billing-owned creative, auto-public, silent training, MediaAsset/GeneratedAsset collapse, silent lock mutation.

## 19. Autonomous authority
**Autonomous:** routine eng, architecture within principles, impl/QA/perf, provider adapters, entitlement technical details within approved rules.  
**Escalate to Brett:** new principles, lock changes, material product/UX, security/privacy, pricing/plans/credit/ad economics, advertiser contracts, legal, destructive data, off-roadmap, vision changes.

## 20. Stage 1 gate
M8 = Platform architecture definition only this stage.  
**No** M8 implementation, payments, ad integrations, billing code, or commercial schema until separate auth after Architect APPROVE + Brett decisions (if any).
