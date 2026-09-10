# YouFlicks Product Owner Commercial Decisions — LOCKED
**Status:** Binding for M8.5/M8.6 planning and engineering within approved architecture  
**Date:** 2026-09-10  
**PO:** Brett  
**Baseline locks:** PHASE_M8_5 / PHASE_M8_6 on origin/main `f6712b3` (impl still gated per CoS Engineer auth)  
**Checkpoint note:** Current free-platform tip may be `e13f766` (M8.4.1); commercial docs at `f6712b3`.

## 1. Subscription tiers
- **FREE** · **PLUS** · **FAMILY**
- Exact pricing **TBD** — do not invent
- PLUS = primary individual paid tier
- FAMILY = preferred early target for core customer segment (parents/families)

## 2. Tier philosophy
### FREE (locked)
Valid email; 1 authorized AI_DIRECT/hour; max 5-minute movie; watermark; advertising enabled.

### PLUS
No watermark; ads off; higher usage; longer movies; increased storage; increased processing priority/capability. Exact numerical limits TBD.

### FAMILY
No watermark; ads off; higher usage; longer movies; larger storage; family profiles; shared family library; parental/family controls; collaboration where supported. Exact numerical limits TBD.

## 3. Prepaid credits
- Prepaid pay-to-play = **YES**
- Do **not** hard-assume 1 credit = 1 movie
- Provider-neutral **usage/credit abstraction** for variable engine consumption
- Customer-facing presentation stays simple
- Initial expiry = **NEVER** (unless later PO change)
- Subscribers **MAY** also purchase prepaid usage
- Unused prepaid credits must **not** silently disappear
- Pack sizes/prices TBD pending cost/usage telemetry

## 4. Ad-funded credits
- **YES, eventually** — free users may earn additional usage via advertising
- Extra ad-earned usage must be **capped** (cap TBD)
- Architecture supports this without changing creative meaning
- Advertising must never create unlimited expensive engine consumption

## 5. Advertising surfaces
- FREE: UI/chrome + post-film + library
- IN-MOVIE: **NO** (unless separate future PO decision)
- PLUS/FAMILY: ads **off** by default

## 6. Sponsors / advertisers
Allowed: UI shell/logo; post-film card; library banner; approved FilmCredits placement.  
Never: inside cut; creative control; story/timeline/provider force; block Keep/Share; reduce quality.  
Initial: prefer **first-party/direct** sponsors; do not hard-wire external ad network into domain.

## 7. Commercial boundary (absolute)
Commercial economics → entitlement/access only. Never CreativePlan / StoryStructure / Timeline / GeneratedAsset / Render meaning. Provider selection = YouFlicks capability routing, not sponsorship.

## 8. Pricing
No exact prices yet. Pricing configurable. Need telemetry/economics before responsible final prices.

## 9. Authority
Authorizes implementation planning and engineering within approved M8 architecture. No new architectural principle. Do not modify M3–M7. Escalate only for new PO decision or new principle.

## Still open (ship blockers, not architecture)
- Exact prices, numerical caps (except FREE locked), credit-pack SKUs, ad-earn cap, refund/chargeback/tax posture, payment provider, external ad vendor (if any).
