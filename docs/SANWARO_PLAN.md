# Sanwaro (सँवारो): Complete Project Plan

Everything from the final, reviewed plan in one file: a multi-tenant salon booking app for small Indian salons, with no double booking, UPI deposits, a walk-in queue and WhatsApp reminders. Built with Next.js (JavaScript) + Supabase, for ₹0.

> **How to read this file:** when a section says "see `TESTING.md`" (or another file name), it means the part of this file with that name. The SQL lives in `docs/database/schema.sql` and `docs/database/cron.sql`; the test scripts live in `docs/starter-tests/` and `docs/verification/`.

## Contents
1. Part 1: Project Plan (`PLAN.md`)
2. Part 2: Competitors and How We Are Different (`COMPETITORS.md`)
3. Part 3: Architecture (`ARCHITECTURE.md`)
4. Part 4: Database Guide (`DATABASE.md`)
5. Part 5: Testing Plan (`TESTING.md`)
6. Part 6: Zero-Budget (Free Tier) Guide (`FREE_TIER.md`)
7. Part 7: Security and Abuse Protection (`SECURITY.md`)
8. Part 8: Feasibility Report (`FEASIBILITY.md`)


---

# Part 1: Project Plan
*(was `PLAN.md`)*


> **Sanwaro** (सँवारो, "get yourself groomed"). Paths in these docs are relative to the `docs/` folder.

**One line:** an online booking system for small Indian salons. Customers pay a small UPI deposit to confirm, walk-ins join a queue that fits around appointments, and the database makes double booking impossible. Many salons run on one app, and none can see another's data.

**Budget: ₹0.** Free plans and test modes only; no card on any account. See `FREE_TIER.md`.

---

## 0. Reality check (read this first)

**What this project IS:** a portfolio-grade, deployed demo that proves real engineering: concurrency, multi-tenancy, idempotent payments and scheduling. Every hard part has been tested on a real PostgreSQL database (62/62 checks, `FEASIBILITY.md`).

**What it is NOT:** a product real salons can use for real money tomorrow. Going live would need things that cost money or legal setup:

| To go live you'd need | Why | Cost |
|---|---|---|
| Phone OTP verification | Today anyone can type anyone's number (see §6, decision 2) | SMS / WhatsApp OTP charges |
| Each salon's own payment account (Razorpay Route linked accounts, or each salon's own keys) | One account collecting every salon's money is payment-aggregator activity, which the RBI regulates | KYC per salon + gateway fees |
| WhatsApp production number | The test number reaches only 5 numbers | Per-message charges |
| Vercel Pro | Hobby is non-commercial only | Monthly fee |
| A proper privacy setup | Real customer phone numbers fall under India's DPDP Act, 2023 | Time + legal care |

**On your resume, say:** "deployed demo", "test-mode payments", "load-tested locally". **Never say:** "production-ready", "used by salons", or "unique walk-in queue" (one global product, Waitwhile, already offers walk-ins + appointments; see `COMPETITORS.md`).

---

## 1. How to use these documents

| File | What it's for | When |
|---|---|---|
| `PLAN.md` | Scope, slices, phases, checklists | Every session |
| `COMPETITORS.md` | What others offer; what we match, skip and do differently | Before adding any feature |
| `ARCHITECTURE.md` | Flows, every API route, folder structure, env vars | Phases 2–7 |
| `DATABASE.md` + `database/schema.sql` | Tables, rules, RLS, functions, cron jobs | Phase 1 and any data change |
| `TESTING.md` | Every test type + pass criteria + results table | Every phase |
| `FREE_TIER.md` | Free limits, traps, keep-alive | Phase 0 and before adding any service |
| `SECURITY.md` | Abuse, rate limits, secrets, privacy | Phases 3, 5, 6, 8 |
| `FEASIBILITY.md` | What was proven, the review findings, what's still open | Read once; re-run after schema changes |

**Rule:** finish a phase's "Done when" before starting the next.

---

## 2. Problem → solution

**Problem:** small salons book over WhatsApp and phone calls. That causes double bookings, no-shows nobody pays for, no reminders, and walk-ins and appointments clashing at the counter.

**Solution:**
- A public booking page showing only genuinely free slots.
- A short hold, then a small UPI deposit to confirm.
- WhatsApp reminders.
- A QR walk-in queue that slots people into real gaps.
- One dashboard for the owner.
- The database itself refuses any overlap.

---

## 3. Stack (only what you already use + free services)

| Layer | Choice |
|---|---|
| App + API | Next.js (App Router), React, **JavaScript** (no TypeScript), Zod for validation |
| Styling | Tailwind CSS |
| Data / Auth / Realtime | Supabase (Postgres, RLS, exclusion constraints, pg_cron, pg_net) |
| Hosting | Vercel Hobby |
| Payments | Razorpay **test mode** |
| Messaging | WhatsApp Cloud API **test number** (5 verified recipients) + on-screen fallback |
| Bot protection | Cloudflare Turnstile |
| Owner login | Google sign-in (Supabase Auth); demo uses a read-only "viewer" login |
| Local dev | Docker + Supabase CLI |
| Tests | pgTAP (`supabase test db`), Vitest, Playwright, k6 |

Not used: Go, TypeScript, Edge Functions, Better Auth, SMS, paid email.

---

## 4. Users and roles

| Role | Login | Can |
|---|---|---|
| Owner | Google | Everything for their salon(s) (max 3) |
| Staff (v2) | Google | See and update only their own bookings |
| Viewer (demo) | Email + password made by hand | **Read-only**: see the demo dashboard, change nothing (tested) |
| Customer | **None** | Book with name + phone; pay; manage through a private link |

---

## 5. Features

### Signature features (built + tested; "different", not "first")
1. **Walk-in queue in the same calendar as appointments.** QR → join → "You're W-07, ~25 min, with Bina". The database picks the earliest real gap across staff; walk-ins and online bookings can never collide. Waitwhile does something similar globally; none of the India-focused tools we checked advertise it.
2. **Smart deposits that explain themselves.** New customer: normal deposit. Regular (3+ visits, no no-shows): **half**. 1 no-show: double. 2+: full price. **₹0 only if the owner marks the customer trusted.** History alone never unlocks free bookings, because phones aren't verified.
3. **No account, no app.** Name + phone + UPI. Confirmation and the manage link are shown **on screen** (always) and sent on WhatsApp (verified test numbers only in the demo).

### MVP, built in slices (Phases 0–7)
- [ ] Owner Google sign-in; create salon; setup (services, staff, staff↔service, hours with breaks, time off, policies, "note for customers")
- [ ] Public booking page; "any available" stylist (tries the next stylist if one is taken)
- [ ] Price shown as "₹X now, ₹Y at the salon"; cancellation policy shown before paying
- [ ] Holds with countdown; **same browser can switch slots** (old hold released)
- [ ] Razorpay test deposits; **checkout opens only with ≥ 3 min left, then the hold extends once to 10 min**
- [ ] Callback + webhook confirmation (both idempotent); late-payment refunds
- [ ] Owner dashboard: calendar per staff, bookings, completed / no-show / cancel, phone bookings, customers (history, notes, trusted, block)
- [ ] **Auto-complete**: visits ending 3+ hours ago become completed unless marked; the owner can still correct to no-show
- [ ] Walk-in queue with a **rotating counter code** (stops people joining from home); "start" button; overdue walk-ins flagged at 10 min, auto-released at 30
- [ ] WhatsApp confirmation + 24 h / 2 h reminders (up to 5 min late, which is fine)
- [ ] Manage page: view, cancel, refund if outside the window
- [ ] Bot protection: Turnstile, honeypot, phone-based limits, generous IP limits (Indian mobile networks share IPs)

### Version 2
Waitlist · staff logins · reports + staff commission · "money saved" card · Hindi/English · QR poster + shareable link · CSV export · per-service buffer · full-prepay option · reschedule · Realtime dashboard · manual `wa.me` reminder button · **better wait estimates from actual start times**

### Version 3
Festival / wedding-season mode · family / group booking · recurring appointments · packages · patch-test flag · installable PWA with offline schedule · last-minute openings to the waitlist · Google Calendar sync (stays in Google's limited testing mode unless the app is verified)

### Skipped on purpose
Marketplace · POS / GST / inventory / payroll / gift cards · card-on-file fees · marketing blasts · native apps · rooms/resources

---

## 6. Design decisions from the review

| # | Problem found | Decision | Tested |
|---|---|---|---|
| 1 | Claimed the walk-in queue was unique; Waitwhile does it | Wording fixed everywhere; positioned as "different for Indian salons" | n/a |
| 2 | Unverified phones → anyone could use a regular's number to book for ₹0 | No ₹0 from history; regulars get half; only owner-marked "trusted" customers get ₹0, and trust is lost after a no-show | 44, 53 |
| 3 | Typing someone's number renamed their customer record | Saved name never overwritten; each booking stores the name typed for it | 54 |
| 4 | One active hold locked customers out for 7 min | A browser key lets the same browser replace its own hold; strangers can't | 55 |
| 5 | Paying in the last seconds led to refunds | `start_payment`: refuse if < 3 min left; extend once to 10 min | 56 |
| 6 | Smart deposits depend on owners marking every visit | Hourly auto-complete; owner can correct completed → no-show | 57 |
| 7 | Walk-ins who leave block slots; people join from home | Counter code to join; start button; auto-release after 30 min | 58, 59 |
| 8 | Shared demo login could be vandalised | Read-only "viewer" role | 60 |
| 9 | Future tables/functions could be exposed to the browser | New tables locked for anon by default; **guard test** fails if any function is callable from the browser without being allow-listed (it caught 190 extension functions in the wrong schema during testing) | 61, 62 |
| 10 | Per-IP limits block real users behind shared mobile / salon Wi-Fi IPs | Limits keyed mainly on phone + Turnstile; IP limits generous | API tests |
| 11 | Money flow can't go live as designed | Test mode only; "going live" path documented (§0) | n/a |
| 12 | WhatsApp can't reach recruiters | Everything shown on screen; WhatsApp is a bonus channel | E2E |
| 13 | Laptop load numbers ≠ production capacity | Resume leads with correctness results; capacity labelled "local" | n/a |
| 14 | Scope too big for one person beside a job | Slices: a live demo after Slice A, then add features one slice at a time | n/a |

---

## 7. The slices and phases

Each slice ends with something **deployed and demo-able**, so you always have a working version to show, even if you stop early.

### Slice A — "It books, and it can't double-book" (no payments)
**Phase 0 — Setup (S)**
- [ ] Free accounts, no card: GitHub, Vercel, Supabase, Razorpay (test), Meta for Developers, Google Cloud (OAuth only), Cloudflare
- [ ] **Check your Supabase free slots first:** the free plan allows 2 active projects, and Velanthe already uses one. If Skillsight's Postgres is also on Supabase, you have no free slot left; decide what to pause before continuing.
- [x] Install Node LTS, Docker Desktop, Supabase CLI, k6 *(2026-10-22: Node 26, Docker, Supabase CLI as an npm dev dependency; k6 still to install, needed in Phase 8)*
- [x] Inside the `sanwaro` folder (lowercase; it already holds `docs/`): `npx create-next-app@latest .` → JavaScript, App Router, Tailwind. The tool allows an existing `docs/` folder; anything else in the folder makes it refuse. Then check `.env*` is in `.gitignore` before the first commit
- [x] `supabase init` → `supabase start` *(done)*; deploy the blank app to Vercel *(waiting on accounts)*
**Done when:** the blank app is live; local Supabase runs; no card anywhere.

**Phase 1 — Database (M)**
- [ ] **Rewrite `schema.sql` yourself**, table by table, using the provided file as the reference; explain each part aloud *(2026-10-22: chose option B, reference schema loaded as-is; walk-through instead)*
- [x] It goes into `supabase/migrations/…_init.sql`; `supabase db reset` *(done)*; `supabase db push` *(done 2026-10-22, project `hviorqizsjugypenhtsp`, Mumbai)*
- [x] pgTAP tests in `supabase/tests/database/` (121 checks, `npm run test:db`); race tests in `tests/db/race.test.mjs` (`npm run test:race`)
**Done when:** `supabase test db` is green; the race test shows 50 → 1; the guard test (61) is green.

**Phase 2 — Owner sign-in and setup (M)**
- [ ] Google sign-in, `@supabase/ssr`, middleware for `/dashboard`
- [ ] Onboarding → `create_business()`; setup pages (services, staff, hours, time off, policies, customer note)
**Done when:** a new owner sets up a salon in under 5 minutes; salon B sees nothing of salon A.

**Phase 3 — Booking page (L), with deposits set to ₹0 for now**
- [ ] `/b/[slug]`, `GET /api/slots`, `POST /api/hold` (Turnstile, honeypot, phone + IP limits, browser `holdKey`)
- [ ] "Any available" stylist: try the next stylist on `SLOT_TAKEN`
- [ ] Confirmation screen with the manage link + copy button; IST display everywhere
**Done when:** two browsers clicking one slot never both win; a bot without Turnstile is rejected.

**Phase 4 — Owner dashboard (M)**
- [ ] Today view per staff, bookings list, completed / no-show / cancel, phone bookings
- [ ] Customers: history, notes, **trusted**, block
- [ ] Demo **viewer** account + seed data; deploy
**Done when:** you can run a day from the dashboard. 🎉 **Slice A is live.** Put it on your resume now as "in progress".

### Slice B — Deposits
**Phase 5 — Payments + smart deposit (L)**
- [ ] `POST /api/payments/order` → `start_payment()` (≥ 3 min check, one extension) → Razorpay order → Checkout
- [ ] `/api/payments/verify` (checkout signature) + `/api/payments/webhook` (raw-body signature) → `confirm_payment()`; refunds → `mark_refunded()`; daily sweep of `refund_pending`
- [ ] Webhook URL = **production** domain (Vercel protects preview deployments)
- [ ] Smart-deposit line on the page ("Half deposit: thanks for coming back!")
- [ ] pg_cron: `expire_stale_holds` (every minute), `auto_complete_bookings` (hourly)
**Done when:** test UPI success/failure both behave; duplicate webhooks change nothing; late payment for a taken slot ends `refunded`.

### Slice C — Walk-ins
**Phase 6 — Walk-in queue (M)**
- [ ] `/q/[slug]` + `POST /api/walkin` with the **counter code** (changes every 10 min, shown on the board)
- [ ] `/q/[slug]/board` (token, masked name, staff, time; 30-second refresh)
- [ ] Dashboard: walk-in badge, "start", "left"; overdue flag at 10 min; `release_stale_walkins` cron
**Done when:** a walk-in from a phone-sized screen gets a wait time matching the calendar; 15 at once → 0 overlaps.

### Slice D — Messages and self-service
**Phase 7 — WhatsApp + cancellation (M)**
- [ ] `Notifier` with `whatsapp` + `log`; `/api/notifications/send` (secret header); pg_cron + pg_net every 5 min
- [ ] Template message (`hello_world` until yours is approved); permanent system-user token
- [ ] `/booking/[token]`: view, cancel, refund if eligible
**Done when:** a booking for tomorrow sends the confirmation now and a 2-hour reminder at the right IST time to your phone.

### Slice E — Prove it and launch
**Phase 8 — Hardening and the full test suite (L)**: every row in `TESTING.md` §13; security checklist; CI.
**Phase 9 — Demo, README, launch (M)**: nightly demo reset; keep-alive (Vercel daily cron + GitHub backup); README with video, diagram and "Proof"; LinkedIn post.
**Phase 10 — Version 2 / 3 features**: only after Phase 9.

---

## 8. Risks

| Risk | Plan |
|---|---|
| Not finishing (the biggest one) | Slices; Slice A is enough to show |
| Not understanding the SQL in interviews | Phase 1 rewrite-it-yourself step; talking points §10 |
| Supabase pause / free slots | Keep-alive; check slots in Phase 0 |
| WhatsApp limits | On-screen confirmation + `log` notifier |
| Abuse of the demo | Viewer role, Turnstile, limits, nightly reset |
| Timezone bugs | `timestamptz`, `Asia/Kolkata` formatting, unit tests with `TZ=UTC` |
| Secret leaks | Server-only admin client; build-output scan |
| Burning free limits with tests | Heavy tests local only |

---

## 9. Definition of done
- [ ] Slices A–D live; the demo works on any day
- [ ] `TESTING.md` §13 filled with real numbers
- [ ] README: video, diagram, proof, and an honest "what it would take to go live" note
- [ ] ₹0 spent
- [ ] You can explain each item in §10 without notes

---

## 10. Resume and interview

**Resume bullet (fill in real numbers):**
> **Sanwaro** — multi-tenant salon booking platform (deployed demo; Next.js, Supabase/PostgreSQL, Razorpay test mode, WhatsApp Cloud API). Database-enforced no-double-booking (PostgreSQL exclusion constraint; 50 concurrent requests → 1 booking); walk-in queue sharing one calendar with online bookings; history-based deposits with abuse safeguards; tenant isolation via Row-Level Security; idempotent payments with late-payment refunds; 60+ automated database tests.

**Talking points**
1. Why a constraint instead of "check then insert"? The race window between the check and the insert.
2. How tenants are isolated: RLS + composite foreign keys + server-only functions + the guard test.
3. Webhooks arriving twice or late: unique payment ID, row lock, refund path.
4. Walk-in placement: candidate starts → filter → earliest; per-salon lock; constraint as the backstop.
5. **Why regulars don't get ₹0:** unverified phones mean history can be impersonated; the owner grants trust instead.
6. What it would take to go live (§0). Saying this shows judgement, not weakness.
7. "Isn't Supabase doing the work?" Show your SQL and your tests.

---

## 11. Decisions log
| Date | Decision | Why |
|---|---|---|
| 2026-10-21 | Next.js + Supabase, JavaScript only | Stack from previous projects |
| 2026-10-21 | Salons only | Avoid health-data obligations |
| 2026-10-21 | No customer accounts | Friction; review complaints about forced accounts/apps |
| 2026-10-21 | Google sign-in for owners | Supabase's free email is ~2 per hour |
| 2026-10-21 | ₹0, test modes only | Portfolio project |
| 2026-10-21 | Simulated usage, no real pilot | No access to a real salon |
| 2026-10-21 | All 14 review findings applied (§6) | Design review |
| 2026-10-21 | Build in slices A–E | Always have something live |

---

# Part 2: Competitors and How We Are Different
*(was `COMPETITORS.md`)*


Researched 21 Oct 2026 from vendor feature pages and review sites (links at the bottom). Feature lists come from what each vendor or reviewer states publicly. Some sources are written by competitors of the products they describe, and that's flagged where it matters.

---

## 1. Who already does this

| Product | Who it's for | Known for |
|---|---|---|
| **Fresha** | Global, salons and spas (listed as available in India) | Free booking page, marketplace, smart calendar, waitlist, deposits / card on file, group appointments, rooms and resources, forms and patch tests, smart pricing, multi-location |
| **Booksy** | Barbers, stylists (strong in US / Europe) | No-Show Protection (deposits, cancellation fees), automated waitlist, last-minute discounts, message blasts, "Trusted Client", block clients |
| **Vagaro / GlossGenius / Square / Setmore** | Global small businesses | All-in-one booking + payments; US-focused |
| **Zenoti** | Large chains (used by Lakmé Salon in India) | Enterprise: memberships, POS, payroll, inventory, marketing, reports |
| **Dingg** (India) | Indian salons | Booking, WhatsApp reminders, POS, inventory, loyalty, gift cards, payroll with commissions |
| **Invoay** (India) | Indian salons | WhatsApp Business API, GST invoicing, memberships, packages, loyalty, inventory, campaigns |
| **Salonist** (India) | Indian salons | Booking, billing, inventory, staff attendance and payroll, SMS/email campaigns |
| **MioSalon** (India) | Indian salons | Calendar sync, SMS / email / WhatsApp reminders, UPI and GST support |
| **TurnQueue / Servqueue** | Walk-in queues (generic) | Digital tokens and wait times, as separate products from appointment booking |
| **Waitwhile** | Global (US-focused), salons and barbershops | **Walk-in waitlist + online appointments synced into one calendar.** Found during the design review, so the walk-in idea is NOT new |

## 2. Feature map: what exists, and what we do with it

✅ = in our plan, ➕ = added because of this research, ⏭ = deliberately skipped (reason given)

### Booking and calendar
| Feature | Seen in | Our plan |
|---|---|---|
| 24/7 online booking page | All | ✅ MVP |
| Per-staff working hours, breaks, time off, which staff does which service | Fresha | ✅ MVP |
| Clash prevention | Fresha | ✅ MVP, enforced by the database (proven under 50 parallel requests) |
| Extra time / buffer after a service | Fresha | ✅ MVP (salon-wide buffer); ➕ per-service buffer in v2 |
| Booking links from Instagram, Google, website | Fresha | ➕ v2: shareable link + **printable QR poster** for the counter |
| Group appointments (several people, one checkout) | Fresha | ➕ v3: "family booking" (me + mum, same time, all-or-nothing) |
| Recurring appointments | Dingg, Zenoti | ➕ v3 |
| Rooms / equipment as bookable resources | Fresha | ⏭ Small salons rarely need it |
| Smart pricing (busy vs quiet hours) | Fresha | ➕ v3, as part of "Festival mode" (§3) |
| Marketplace listing | Fresha, Booksy, Vagaro | ⏭ A marketplace needs many salons; not a portfolio feature |

### No-shows, payments, policies
| Feature | Seen in | Our plan |
|---|---|---|
| Deposits at booking | Fresha, Booksy | ✅ MVP (UPI-first through Razorpay test mode) |
| Card on file + late-cancel / no-show fees | Fresha, Booksy | ⏭ Card-on-file is uncommon for small Indian salons; UPI deposits fit better |
| Cancellation policy shown and enforced | Booksy, Fresha | ✅ MVP; ➕ the policy text is shown **before** paying |
| Deposit counted towards the final bill | Booksy, Fresha | ➕ MVP: confirmation and dashboard show "₹100 paid, ₹200 at the salon" |
| Trusted clients skip prepayment | Booksy ("Trusted Client") | ✅ Same idea, owner-controlled: only owner-marked customers get ₹0; history gives **half** a deposit, never ₹0 (phones are unverified) |
| Block a client | Booksy | ✅ MVP |
| Full prepayment option | Fresha | ➕ v2 |

### Waitlist and filling gaps
| Feature | Seen in | Our plan |
|---|---|---|
| Waitlist that offers freed slots | Fresha (several modes), Booksy | ✅ v2 (moved up from v3, since it's standard) |
| Last-minute discount / message blasts | Booksy | ➕ v3: "last-minute opening" message to the waitlist only |
| **Walk-in queue in the same calendar** | Waitwhile (global); separate queue products | ➕ Signature feature for **Indian** salons (§3), built and tested. Not a first. |

### Clients and communication
| Feature | Seen in | Our plan |
|---|---|---|
| Automated confirmations and reminders | All | ✅ MVP via WhatsApp |
| WhatsApp-native reminders | Dingg, Invoay, MioSalon (India) | ✅ MVP. Reviewers report Dingg's WhatsApp lagging, and Salonist users asking for a WhatsApp API |
| Client profiles, history, notes | All | ✅ MVP |
| Custom text in confirmations (parking, directions) | Missing in Booksy per reviewers | ➕ MVP: a "note for customers" setting added to every confirmation |
| Digital consultation forms / patch-test flags | Fresha | ➕ v3: "needs patch test" flag on a service, shown when booking |
| Customer self-service (view, cancel) | Booksy | ✅ MVP, through a private link, **no app, no account** |
| Marketing campaigns, birthdays | Invoay, Dingg | ⏭ Spam risk + WhatsApp template costs; out of scope |

### Business operations
| Feature | Seen in | Our plan |
|---|---|---|
| Reports | All | ✅ v2 |
| Staff commission report | Dingg, Fresha | ➕ v2 (read-only report) |
| POS, GST invoicing, inventory, payroll, gift cards, memberships | Indian tools, Zenoti | ⏭ Each is a product on its own; adds no technical depth for this portfolio |
| Packages ("5 facials for the price of 4") | Invoay, Salonist | ➕ v3 (prepaid visit counter) |
| Multi-location | Fresha, Zenoti | ⏭ Our model already supports many salons per owner (max 3) |
| Native mobile apps | Most | ⏭ Mobile-friendly web; ➕ v3 installable PWA |
| Data export | — (migration pain in Zenoti reviews) | ➕ v2: CSV export of customers and bookings anytime |

---

## 3. How Sanwaro is different (honest version)

None of our features is a world first. The difference is **the combination, built for small Indian salons** (UPI deposits, WhatsApp, walk-in heavy, no app), with each piece proven on a real database. Our research read vendor pages and review sites; it was not exhaustive.

### ⭐ Signature 1: Walk-in queue in the same calendar as appointments (built + tested, checks 47–51, 58–59)
- **Who else:** Waitwhile (global, US-focused) syncs walk-in waitlists and appointments into one calendar. Among the India-focused tools we read (Dingg, Invoay, Salonist, MioSalon), none advertised it.
- **How ours works:** a QR at the counter → `/q/glow-salon` → enter the **counter code** shown on the salon's screen (changes every 10 min, so people can't join from home) → "You're W-07, about 25 min, with Bina".
- The database finds the earliest real gap across all staff: now, after a booking ends, or when a shift starts. It never collides with online bookings (same calendar, same no-double-booking rule).
- Walk-ins who leave are flagged at 10 min and auto-released at 30 min, and staff tap "start" when someone sits down.
- **Honest limit:** the wait estimate assumes services run on time. Version 2 re-estimates from actual start times.

### ⭐ Signature 2: Smart, explainable deposits with abuse safeguards (built + tested, checks 44–46, 53)
| Customer history | Deposit |
|---|---|
| Owner marked "trusted", no no-shows | ₹0 (confirmed instantly) |
| 3+ completed visits, no no-shows | **half** deposit |
| New customer | normal deposit |
| 1 no-show | double deposit (capped at price) |
| 2+ no-shows | full price upfront |

- **Who else:** Booksy's "Trusted Client" lets an owner switch prepayment off per client.
- **Ours adds:** graded automatic rules and a reason shown to the customer.
- **Why history never gives ₹0:** phone numbers aren't verified (OTP costs money), so anyone could type a regular's number. The owner decides who is trusted.

### ⭐ Signature 3: No account, no app
Name + phone + UPI. Confirmation and the manage link are **always shown on screen** (with a copy button) and also sent on WhatsApp. In the free demo, WhatsApp only reaches 5 verified numbers. This answers review complaints about required accounts and forced app downloads.

### Other differences (planned)
| Idea | Why it matters | Version |
|---|---|---|
| Hindi / English booking page | Salonist reviewers asked for multilingual support | v2 |
| "Money saved" card (deposits kept from no-shows + slots refilled) | Owners see the value in rupees | v2 |
| Festival / wedding-season mode | Diwali and wedding season are peak demand in India | v3 |
| Installable PWA with offline schedule | Salonist reviewers asked for offline access | v3 |
| CSV export anytime | Migration pain shows up in Zenoti reviews | v2 |
| "₹X now, ₹Y at the salon" pricing | Fewer disputes at the counter | MVP |

## 4. Pain points found in reviews (and our answer)

| Pain point | Source | Our answer |
|---|---|---|
| Client accounts required → drop-off | MioSalon's comparison of Fresha / Vagaro (**written by a competitor**, so treat with care) | No customer accounts at all |
| Booking via referral link forces an app download | Booksy reviews (Capterra India) | No app; web link + WhatsApp |
| Can't add parking / directions to confirmations | Booksy reviews | "Note for customers" setting |
| WhatsApp messages lag; reminders unreliable | Dingg reviews (Capterra India) | Retry with a status per message; owner can see `sent / failed` per reminder |
| Wants WhatsApp API, multilingual, self-booking, offline | Salonist reviews (Capterra) | WhatsApp-first, Hindi/English, self-booking, offline PWA (v3) |
| Complex, manual setup; long contracts; opaque price | Zenoti reviews; MioSalon comparison | 5-minute setup goal; free |
| 20% fee on new-client marketplace bookings | MioSalon's comparison of Fresha (**competitor-written; verify before quoting**) | No marketplace, no commission |

---

## 5. What changed in the plan because of this research
- **MVP gained:** cancellation policy shown before payment; "paid now / pay at the salon"; "note for customers" in confirmations.
- **v2 gained:** waitlist (standard elsewhere), QR poster + link, Hindi/English, "money saved", CSV export, commission report, per-service buffer, full prepay.
- **Signature features:** walk-in queue and smart deposits. Both built and tested; both corrected after the design review (counter code; no ₹0 from history).
- **v3 gained:** family booking, recurring appointments, festival mode, packages, patch-test flag, PWA, last-minute openings.
- **Skipped:** marketplace, POS/GST/inventory/payroll, card-on-file fees, marketing blasts, native apps, rooms/resources.

## Sources
- Fresha scheduling features: https://www.fresha.com/en-GB/for-business/features/scheduling
- Fresha payment policies: https://www.fresha.com/help-center/knowledge-base/payments/613-payments-policies-overview
- Booksy No-Show Protection: https://biz.booksy.com/en-us/features/no-show-protection
- Booksy reviews (Capterra India): https://capterra.in/reviews/142741/booksy
- Dingg (Capterra India): https://www.capterra.in/software/202682/dingg
- Zenoti (Capterra India): https://www.capterra.in/software/131057/zenoti
- Salonist reviews (Capterra): https://www.capterra.com/p/239848/Salonist/reviews/
- Invoay salon software India: https://invoay.com/salon-software-india/
- Salon software India roundup: https://www.salonbookingsystem.com/salon-booking-system-blog/salon-software-india/
- MioSalon comparison (competitor-written): https://blog.miosalon.com/10-best-salon-software-hands-on-comparison-for-salons-in-2026/
- Queue products: https://www.capterra.in/software/1111762/Servqueue , https://www.getapp.co.uk/software/2089792/turnqueue
- Waitwhile (walk-ins + appointments in one calendar): https://waitwhile.com/salon-hairdresser-waitlist/

---

# Part 3: Architecture
*(was `ARCHITECTURE.md`)*


## 1. The big picture

```
                          ┌──────────────────────────────┐
  Customer's phone ──────▶│  Next.js on Vercel (Hobby)   │
  (no account)            │                              │
                          │  Pages  /b/[slug]            │
  Owner's browser ───────▶│         /dashboard/*         │
  (Google sign-in)        │         /booking/[token]     │
                          │                              │
                          │  API    /api/slots           │──┐ service-role key
                          │  routes /api/hold            │  │ (server only)
                          │         /api/payments/*      │  │
                          │         /api/booking/*       │  │
                          │         /api/notifications/* │  │
                          │         /api/keep-alive      │  │
                          └───┬──────────────▲───────────┘  │
           Turnstile check    │              │ webhook      │
   ┌──────────────────────────┘              │              ▼
   ▼                                         │   ┌───────────────────────────┐
 Cloudflare                       Razorpay ──┘   │  Supabase (Free)          │
 Turnstile                        (test mode)    │  Postgres + RLS           │
                                                 │  exclusion constraint     │
 WhatsApp Cloud API ◀── /api/notifications/send  │  SQL functions            │
 (test number, 5 recipients)        ▲            │  pg_cron ── every minute: │
                                    │            │    expire holds           │
                                    └────────────│  pg_cron + pg_net ── 5min:│
                                     HTTP POST   │    call notifications API │
                                                 │  Auth (Google)            │
 Owner's browser ── supabase-js + owner session ▶│  Realtime (dashboard)     │
                    (RLS applies)                └───────────────────────────┘
```

**Two ways the app talks to Supabase:**

| Client | Key | Used for | RLS? |
|---|---|---|---|
| Browser client (`lib/supabase/browser.js`) | anon / publishable key | Owner dashboard reads and writes | **Yes**: the owner only sees their salon |
| Server client (`lib/supabase/admin.js`) | service-role / secret key | API routes calling SQL functions (`create_hold`, `confirm_payment`, …) | Bypassed, so every route validates its own input |

Put `import 'server-only'` at the top of `lib/supabase/admin.js`, so the build fails if a client component ever imports it.

---

## 2. Booking flow (customer)

```
1. Open /b/glow-salon
2. GET /api/slots?salon=glow-salon&service=<id>&date=2026-10-24&staff=any
      → get_free_slots()  → [{staffId, staffName, start, end}, ...]
3. Pick slot, enter name + phone, Turnstile runs invisibly
   The browser keeps a random holdKey (sessionStorage) for this visit.
4. POST /api/hold  {salon, serviceId, staffId|'any', start, name, phone, holdKey, turnstileToken, website:""}
      → honeypot empty?        else silently 200 with fake success
      → Turnstile valid?       else 403
      → check_rate(phone) strict / check_rate(ip) generous   else 429
      → create_hold(..., holdKey)
           same holdKey already holding another slot → that hold is released first
           staff = 'any' → API tries each stylist free at that time until one succeeds
      → {bookingId, status:'held', holdExpiresAt, deposit, depositReason, manageToken}
         or status:'confirmed' if deposit = 0 (pay-at-salon service or owner-trusted customer)
5. If held: POST /api/payments/order {bookingId, holdKey}
      → start_payment(): refuses if < 3 min left (HOLD_TOO_LATE → "pick again"),
        otherwise extends the hold ONCE to 10 min
      → Razorpay order → open Checkout
6. Customer pays (test UPI: success@razorpay)
7a. Checkout success handler → POST /api/payments/verify {orderId, paymentId, signature}
       → verify checkout signature → confirm_payment() → show "Booked!"
7b. Razorpay → POST /api/payments/webhook (payment.captured)
       → verify webhook signature on the RAW body → confirm_payment()
   (7a and 7b both happen; whichever runs second gets ALREADY_PROCESSED.)
8. confirm_payment() schedules confirmation + 24h + 2h notifications
9. Confirmation screen ALWAYS shows the booking + manage link (copy button);
   WhatsApp is an extra channel (only verified numbers in the free demo)
```

**Why both 7a and 7b?** 7a gives instant feedback. 7b is the source of truth if the customer closes the tab. Both are safe because `confirm_payment()` locks the payment row and stores the payment ID once.

## 3. Late payment flow (proven in `FEASIBILITY.md`)

```
Customer X holds 18:00 → doesn't pay in time → hold expires
Customer Y picks 18:00 → create_hold() lazily expires X's hold → Y holds 18:00
X's payment finally arrives → confirm_payment():
     tries expired → confirmed → exclusion constraint refuses (Y is there)
     → payment marked refund_pending → returns REFUND_NEEDED
API route → Razorpay refund API → mark_refunded()
```
If X's slot is still free when the late payment arrives, X's booking is simply revived and confirmed.

## 3b. Walk-in queue flow (signature feature, proven in `FEASIBILITY.md`)

```
Customer scans QR at the counter → /q/glow-salon → picks service, name, phone,
   and types the 4-digit COUNTER CODE shown on the salon's queue screen
POST /api/walkin {salon, serviceId, name, phone, staffId?, counterCode}
   → counter code valid for this 10-minute window or the previous one? else 403
     (code = HMAC(WALKIN_CODE_SECRET, salonId + window) → 4 digits; stops joining from home)
   → rate limit (per phone; IP limit generous because of salon Wi-Fi)
   → join_walkin_queue():
        one active place per phone (WALKIN_ALREADY_QUEUED)
        lock walk-ins for this salon (advisory lock, one at a time)
        candidate starts per staff = now (next 5-min mark)
                                   ∪ end of each active booking
                                   ∪ start of each working window today
        keep candidates inside today's schedule and not overlapping anything
        earliest wins → insert booking (status confirmed, source 'walkin', deposit 0)
        if an online hold grabbed it a moment earlier → try the next gap
   → {token W-07, staff, startAt, waitMinutes, manageToken}
GET /api/walkin/board?salon=glow-salon  → today's walk-ins (masked names), refreshed every 30 s
```
Walk-ins and online bookings live in **one calendar** under the same exclusion constraint, so they can never collide.

At the counter: staff tap **start** when the person sits down (`started_at`). The dashboard flags walk-ins not started 10 min after their time ("still here?" → start / left). `release_stale_walkins()` (cron, every 5 min) cancels unstarted walk-ins 30 min past their time.

**Honest limit:** wait times assume services run on time. v2 re-estimates from actual `started_at` times.

## 3c. Smart deposit

`create_hold()` calls `deposit_for(customer, service)` when the salon has `smart_deposit` on:

| Rule | Deposit | Reason shown |
|---|---|---|
| Owner marked trusted, no no-shows | ₹0 | "No deposit needed" |
| 3+ completed visits, no no-shows | half | "Half deposit, thanks for coming back!" |
| new | normal | "A small deposit holds your slot" |
| 1 no-show | double | "Deposit is higher after a missed visit" |
| 2+ no-shows | full price | "Full payment needed after missed visits" |

History never gives ₹0, because phone numbers are not verified. `auto_complete_bookings()` (hourly) marks visits completed 3 h after they end, so the history fills even if owners forget; owners can still correct to no-show.

## 4. Reminder flow

```
pg_cron (*/5) ── pg_net POST ──▶ /api/notifications/send  (header x-notify-secret)
   → claim_due_notifications(20)     -- FOR UPDATE SKIP LOCKED, sets status 'sending'
   → for each: Notifier.send(phone, template, params)
   → finish_notification(id, ok, error)   -- ok → 'sent'; fail → retry, 'failed' after 3
```
Cancelling, expiring, completing or no-showing a booking automatically marks its pending notifications as `skipped` (database trigger).

## 5. API routes

All routes validate input with **Zod**, return JSON, and never leak database error text to the user.

| Method & path | Who calls it | Input | Success | Protection |
|---|---|---|---|---|
| `GET /api/slots` | Booking page | `salon` slug, `service`, `date` (YYYY-MM-DD), `staff` (id or `any`) | `200 [{staffId, staffName, start, end}]` (deduplicated by time when `any`) | 120/min per IP |
| `POST /api/hold` | Booking page | `salon, serviceId, staffId or 'any', start, name, phone, holdKey, turnstileToken, website` | `200 {bookingId, status, holdExpiresAt, deposit, depositReason, manageToken}` | Turnstile, honeypot, 3/hour per phone, 20/hour per IP |
| `POST /api/payments/order` | Booking page | `bookingId, holdKey` | `200 {orderId, amount, keyId, holdExpiresAt}` | `start_payment()` (key must match, ≥ 3 min left); reuses an existing order for the booking |
| `POST /api/payments/verify` | Checkout success handler | `orderId, paymentId, signature` | `200 {result}` | Checkout signature (key secret) |
| `POST /api/payments/webhook` | Razorpay | raw body + `X-Razorpay-Signature` | `200` always after processing; `400` bad signature | Webhook signature (webhook secret) |
| `GET /api/booking/[token]` | Manage page | token in URL | `200 {service, staff, start, status, canCancel, refundIfCancelled}` | Unguessable UUID token; 30/min per IP |
| `POST /api/booking/[token]/cancel` | Manage page | — | `200 {outcome, refund}` | Token; 5/hour per IP |
| `POST /api/walkin` | Walk-in page (QR) | `salon, serviceId, name, phone, staffId?, counterCode, turnstileToken, website` | `200 {token, staffName, startAt, waitMinutes, manageToken}` | Counter code, Turnstile, honeypot, 1 active place per phone (database), 30/hour per IP |
| `GET /api/walkin/board` | Queue board | `salon` slug | `200 {counterCode, queue: [{token, maskedName, staffName, startAt, status}]}` (today only) | Code only for the salon's signed-in screen; 60/min per IP; no phones |
| `POST /api/notifications/send` | pg_cron via pg_net | — | `200 {sent, failed}` | `x-notify-secret` header |
| `GET /api/keep-alive` | Vercel daily cron | — | `200` | `Authorization: Bearer CRON_SECRET` |

**Owner actions don't need API routes.** The dashboard uses supabase-js with the owner's session, and RLS decides what's allowed.

### Error codes → what the user sees

| Database error | HTTP | Message |
|---|---|---|
| `SLOT_TAKEN` | 409 | "Someone just booked this slot. Please pick another time." |
| `ACTIVE_HOLD_EXISTS` | 409 | "You already have a slot on hold. Finish that payment or wait a few minutes." |
| `OUTSIDE_SCHEDULE` | 400 | "That time isn't available." |
| `SLOT_IN_PAST` | 400 | "That time has already passed." |
| `TOO_FAR_AHEAD` | 400 | "Bookings open up to N days ahead." |
| `CUSTOMER_BLOCKED` | 403 | "Online booking isn't available for this number. Please call the salon." |
| `STAFF_CANNOT_DO_SERVICE` / `SERVICE_NOT_FOUND` / `BUSINESS_NOT_FOUND` | 404 | "Not found." |
| `NO_GAP_TODAY` | 409 | "The queue is full for today. Book online for another day?" (link to `/b/slug`) |
| `QUEUE_BUSY` | 503 | "Lots of people joining right now. Please try again." |
| `WALKIN_ALREADY_QUEUED` | 409 | "You're already in the queue." (show their token) |
| wrong counter code | 403 | "Enter the code shown on the salon's screen." |
| `HOLD_TOO_LATE` | 409 | "Your hold is about to run out. Please pick the slot again." |
| `HOLD_EXPIRED` / `HOLD_NOT_FOUND` | 409 | "Your hold has expired. Please pick a slot again." |
| rate limit hit | 429 | "Too many attempts. Try again later." |
| anything else | 500 | "Something went wrong." (log the real error server-side) |

---

## 6. Folder structure

```
sanwaro/
├─ app/
│  ├─ page.js                      # landing page
│  ├─ login/page.js                # Google sign-in + demo login
│  ├─ b/[slug]/page.js             # public booking page
│  ├─ q/[slug]/page.js             # walk-in: join the queue (QR target)
│  ├─ q/[slug]/board/page.js       # public queue board (NO counter code)
│  ├─ booking/[token]/page.js      # customer manage / cancel
│  ├─ dashboard/
│  │  ├─ layout.js                 # requires session
│  │  ├─ page.js                   # today view
│  │  ├─ queue-screen/page.js      # signed-in TV/tablet at the counter: queue + rotating counter code
│  │  ├─ bookings/page.js
│  │  ├─ customers/page.js
│  │  ├─ services/page.js
│  │  ├─ staff/page.js
│  │  ├─ hours/page.js
│  │  └─ settings/page.js
│  └─ api/
│     ├─ slots/route.js
│     ├─ hold/route.js
│     ├─ payments/order/route.js
│     ├─ payments/verify/route.js
│     ├─ payments/webhook/route.js
│     ├─ walkin/route.js
│     ├─ walkin/board/route.js
│     ├─ booking/[token]/route.js
│     ├─ booking/[token]/cancel/route.js
│     ├─ notifications/send/route.js
│     └─ keep-alive/route.js
├─ lib/
│  ├─ supabase/browser.js          # anon key
│  ├─ supabase/server.js           # anon key + cookies (server components)
│  ├─ supabase/admin.js            # service-role key, import 'server-only'
│  ├─ razorpay.js                  # orders, refunds, signature helpers
│  ├─ turnstile.js                 # siteverify call
│  ├─ notifier/index.js            # picks whatsapp or log
│  ├─ notifier/whatsapp.js
│  ├─ notifier/log.js
│  ├─ rate-limit.js                # wraps check_rate()
│  ├─ errors.js                    # DB error → HTTP + message
│  ├─ time.js                      # IST formatting
│  ├─ money.js                     # rupees ↔ paise
│  └─ validation.js                # Zod schemas
├─ middleware.js                   # refreshes session, guards /dashboard
├─ supabase/
│  ├─ migrations/                  # schema.sql goes here
│  ├─ tests/database/              # pgTAP tests
│  └─ seed.sql
├─ tests/
│  ├─ unit/                        # Vitest
│  ├─ api/                         # route tests against local Supabase
│  └─ e2e/                         # Playwright
├─ load/                           # k6 scripts
├─ scripts/
│  ├─ seed-history.mjs             # 90 days of fake history (Faker, Indian locale)
│  └─ simulate.mjs                 # bot customers
├─ .github/workflows/
│  ├─ ci.yml                       # lint + unit + db tests
│  └─ keep-alive.yml               # backup ping every 3 days
├─ vercel.json                     # daily cron → /api/keep-alive
└─ README.md
```

---

## 7. Environment variables

| Name | Where | Secret? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | No | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | No (public by design) | Newer dashboards call it the "publishable" key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `.env.local` | **YES** | Newer dashboards call it the "secret" key. **Never** prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Vercel + `.env.local` | No | Starts with `rzp_test_` |
| `RAZORPAY_KEY_SECRET` | Vercel + `.env.local` | **YES** | |
| `RAZORPAY_WEBHOOK_SECRET` | Vercel + `.env.local` | **YES** | You choose it when creating the webhook |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Vercel + `.env.local` | No | |
| `TURNSTILE_SECRET_KEY` | Vercel + `.env.local` | **YES** | |
| `WHATSAPP_TOKEN` | Vercel | **YES** | Use a permanent system-user token, not the temporary one |
| `WHATSAPP_PHONE_NUMBER_ID` | Vercel | No | From WhatsApp → API Setup |
| `NOTIFIER` | Vercel + `.env.local` | No | `whatsapp` in production, `log` locally and in tests |
| `NOTIFY_SECRET` | Vercel + `private.app_config` | **YES** | Same value in both places |
| `CRON_SECRET` | Vercel | **YES** | Vercel sends it as `Authorization: Bearer …` to cron routes |
| `WALKIN_CODE_SECRET` | Vercel + `.env.local` | **YES** | Used to derive the rotating 4-digit counter code |
| `APP_URL` | Vercel + `.env.local` | No | For links in messages |

Add `.env*` to `.gitignore` before your first commit. If a secret ever gets committed, rotate it, because deleting the file doesn't remove it from git history.

---

## 8. Rules that prevent the classic bugs

**Time**
- Store every moment as `timestamptz` (UTC inside Postgres).
- A business has a `timezone` (default `Asia/Kolkata`). Working hours are local times, converted inside SQL.
- Show times with `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ... })`. Never rely on the server's timezone, because Vercel runs in UTC.
- Ranges are half-open `[start, end)`, so 10:00–10:40 and 10:40–11:20 don't overlap.

**Money**
- Store and send **paise as integers** (Razorpay amounts are in paise too).
- Convert user input with `rupeesToPaise()` (string parsing, no floats). Display with `(paise / 100).toFixed(2)`.

**Webhooks**
- Register the Razorpay webhook on your **production** URL. Vercel normally protects preview deployments, which would likely block Razorpay.
- Read the body with `await request.text()` **before** any JSON parsing. The signature only matches the raw bytes (proven in `verification/payments.test.mjs`).
- Compare signatures with `crypto.timingSafeEqual`, checking lengths first.
- Return `200` for `ALREADY_PROCESSED`. Otherwise Razorpay keeps retrying.

**Errors**
- Raise named errors in SQL (`raise exception 'SLOT_TAKEN'`), map them in `lib/errors.js`, and never show raw database messages to users.

---

# Part 4: Database Guide
*(was `DATABASE.md`)*


The full SQL is in `database/schema.sql` (tables, RLS, triggers, functions, permissions) and `database/cron.sql` (scheduled jobs, Supabase only). The schema was tested on PostgreSQL 16 before this plan was written: **62/62 checks pass**, including real concurrency tests, both signature features (walk-in queue, smart deposits) and every fix from the design review. See `FEASIBILITY.md`.

---

## 1. Tables at a glance

| Table | One row = | Key columns | Notes |
|---|---|---|---|
| `businesses` | a salon (tenant) | `slug`, `timezone`, `buffer_min`, `hold_minutes`, `cancel_window_hours`, `max_days_ahead`, `slot_step_min`, `smart_deposit`, `customer_note`, `is_demo` | Policies live here as columns |
| `memberships` roles | | `owner`, `staff`, **`viewer`** | `viewer` = read-only demo login (no write policies anywhere) |
| `memberships` | a user's role in a salon | `user_id`, `business_id`, `role` (`owner`/`staff`), `staff_id` | Drives every RLS policy |
| `staff` | a stylist | `name`, `active` | |
| `services` | a service | `duration_min`, `price_paise`, `deposit_paise` | Deposit ≤ price (enforced) |
| `staff_services` | "Ravi can do Haircut" | `staff_id`, `service_id` | |
| `working_hours` | one working window | `weekday` (0 = Sunday), `start_time`, `end_time` | Breaks = gaps between windows; overlapping windows are rejected |
| `time_off` | leave / holiday | `period` (tstzrange) | |
| `customers` | a customer of one salon | `phone` (10-digit Indian mobile, **not verified**), `no_show_count`, `blocked`, `trusted` (owner-set), `notes` | Unique per salon + phone; the saved name is never overwritten by later bookings |
| `bookings` | an appointment or walk-in | `slot` (tstzrange), `status`, `hold_expires_at`, `manage_token`, `source` (`online` / `manual` / `walkin`), `deposit_paise`, `booked_name`, `hold_key`, `payment_started_at`, `started_at` | The heart of the system; walk-ins and appointments share it |
| `payments` | a Razorpay order | `razorpay_order_id` (unique), `razorpay_payment_id` (unique), `amount_paise`, `status` | Unique IDs make webhooks idempotent |
| `notifications` | one message to send | `kind`, `send_at`, `status`, `attempts` | Unique per booking + kind |
| `rate_events` | one counted request | `key`, `created_at` | Cleaned daily |
| `private.app_config` | a server-only setting | `key`, `value` | Not reachable through the API |

**Composite foreign keys** (e.g. `(staff_id, business_id) → staff(id, business_id)`) make it impossible to attach salon B's stylist to a salon A booking, even through a bug in your code. Tested: check 37.

---

## 2. The double-booking rule

```sql
constraint no_double_booking exclude using gist (
  staff_id with =,
  slot     with &&
) where (status in ('held', 'confirmed'))
```

In plain words: **for the same staff member, no two active bookings may have overlapping time ranges.** Postgres enforces this at the moment of insert or update, inside its own locking. Two requests arriving in the same millisecond cannot both pass.

- `slot` = `[start, start + duration + buffer)`, so the buffer is protected too.
- Half-open ranges mean back-to-back bookings (10:00–10:40, then 10:40–11:20) are allowed.
- Only `held` and `confirmed` bookings count. Cancelled, expired, completed and no-show rows stay as history without blocking anything.
- It needs the `btree_gist` extension (available on Supabase).

The naive approach ("SELECT to check if it's free, then INSERT") has a gap between the check and the insert. Under load, two requests both see "free" and both insert. That's the bug in most tutorial booking apps.

---

## 3. Booking statuses

```
            pay                       after appointment (or auto, 3 h after end)
  held ───────────▶ confirmed ───────────────────────▶ completed ──owner corrects──▶ no_show
   │                   │  │
   │ timeout           │  └────────────────────────▶ no_show  (customer.no_show_count + 1)
   ▼                   ▼
 expired ──pay late──▶ confirmed     cancelled  (from held or confirmed)
   (only if the slot is still free)
```

The `bookings_guard` trigger enforces this. Anything else raises `INVALID_STATUS_TRANSITION`. Also:
- `completed` / `no_show` only after the appointment has started (`APPOINTMENT_NOT_STARTED`)
- `business_id`, `customer_id` and `manage_token` can never change
- leaving `held`/`confirmed` marks pending notifications as `skipped`

---

## 4. Row Level Security matrix

Supabase lets the browser's keys reach any table **unless RLS stops it**. Every public table has RLS on (check 01).

| Table | Anonymous (browser, not logged in) | Owner of the salon | Staff of the salon | Viewer (demo) | Owner of another salon |
|---|---|---|---|---|---|
| businesses | ✗ | read, update | read | read | ✗ |
| staff / services / staff_services / working_hours / time_off | ✗ | read, write | read | read | ✗ |
| customers | ✗ | read, write (incl. `trusted`, `blocked`) | read | read | ✗ |
| bookings | ✗ | read all; update; insert phone bookings (`confirmed` + `manual` only) | read & update **own** only | read | ✗ |
| payments / notifications | ✗ | read | ✗ | read | ✗ |
| rate_events | ✗ | ✗ | ✗ | ✗ | ✗ |

The anon role also has all table privileges revoked, which is a second lock behind RLS.

**Example policy:**
```sql
create policy bk_select on public.bookings for select to authenticated
  using (public.is_owner(business_id) or public.is_viewer(business_id)
         or staff_id = public.my_staff_id(business_id));
```
`is_owner()` / `is_member()` / `is_viewer()` / `my_staff_id()` are small `security definer` helpers that only look up **your own** membership.

---

## 5. Functions

**Server-only.** Locked to `service_role`, so the browser **cannot** call them. Tested: check 36.

| Function | Called by | What it does |
|---|---|---|
| `get_free_slots(business, service, date, staff?)` | `GET /api/slots` | Generates slots in the salon's timezone from working windows; removes time off, active bookings, past times and too-far dates |
| `create_hold(business, staff, service, start, name, phone, hold_key)` | `POST /api/hold` | Validates everything, upserts the customer (keeping their saved name), releases this browser's own previous unpaid hold, lazily expires stale holds, works out the deposit (`deposit_for` when smart deposit is on), inserts the booking (`held`, or `confirmed` if deposit = 0). Errors: `SLOT_TAKEN`, `ACTIVE_HOLD_EXISTS`, `OUTSIDE_SCHEDULE`, `SLOT_IN_PAST`, `TOO_FAR_AHEAD`, `CUSTOMER_BLOCKED`, `STAFF_CANNOT_DO_SERVICE`, … |
| `deposit_for(customer, service)` | `create_hold` | ⭐ Smart deposit: no-deposit service → 0; **owner-trusted** with 0 no-shows → 0; 2+ no-shows → full price; 1 → double (capped); 3+ completed, 0 no-shows → **half**; else normal. History alone never gives ₹0 (phones unverified) |
| `start_payment(booking, hold_key)` | `POST /api/payments/order` | Refuses if the hold has < 3 min left (`HOLD_TOO_LATE`) or the browser key doesn't match (`HOLD_NOT_FOUND`); extends the hold **once** to 10 min |
| `auto_complete_bookings()` | pg_cron hourly | Confirmed bookings that ended 3+ h ago → completed (walk-ins only if started) |
| `release_stale_walkins()` | pg_cron every 5 min | Unstarted walk-ins 30+ min past their time → cancelled (slot freed) |
| `join_walkin_queue(business, service, name, phone, staff?)` | `POST /api/walkin` | ⭐ Walk-in queue: per-salon advisory lock; candidate starts = now (next 5-min mark), end of each active booking, start of each working window today; earliest free one wins; retries if an online hold took it. Errors: `NO_GAP_TODAY`, `QUEUE_BUSY`, `CUSTOMER_BLOCKED`, `WALKIN_ALREADY_QUEUED` |
| `confirm_payment(order_id, payment_id, amount_paise)` | verify + webhook routes | Locks the payment; idempotent; confirms or revives the booking; returns `CONFIRMED`, `ALREADY_PROCESSED`, `REFUND_NEEDED`, `AMOUNT_MISMATCH` or `UNKNOWN_ORDER` |
| `mark_refunded(payment_id, refund_id)` | after the Razorpay refund API | `refund_pending` → `refunded` |
| `cancel_booking(token)` | manage page | Cancels; returns `CANCELLED_REFUND` / `CANCELLED_NO_REFUND` / `CANCELLED` / `NOT_CANCELLABLE` / `NOT_FOUND` |
| `expire_stale_holds()` | pg_cron every minute | `held` past expiry → `expired` |
| `claim_due_notifications(limit)` | notifications route | `FOR UPDATE SKIP LOCKED` claim, so two workers never take the same message |
| `finish_notification(id, ok, error)` | notifications route | `sent`, or retry, or `failed` after 3 attempts |
| `check_rate(key, max, window_seconds)` | API routes | Race-safe counter (advisory lock per key) |
| `cleanup_rate_events()` | pg_cron daily | Deletes counters older than a day |

**For logged-in owners**
| `create_business(name, slug)` | onboarding | Creates the salon + owner membership; max 3 salons per owner |

> **Supabase trap (tested):** by default, any function in `public` can be called through the API by anyone holding the public key. That's why `schema.sql` ends with `revoke execute … from public, anon, authenticated` and `grant … to service_role`. Every time you add a function, add it to that list. Check 36 fails if you forget.

---

### Planned schema additions (write them as new migrations in their phase)
| Phase | Change |
|---|---|
| 7 | Add a `'turn_soon'` value to `notifications.kind` ("your turn in ~10 min" for walk-ins) |
| v2 | `waitlist` table (business, service, staff?, date, customer, status, offered_at, expires_at) + `offer_waitlist()` function using `SKIP LOCKED` |
| v2 | `staff_invites` table (business, email, staff_id, token, accepted_at) |
| v2 | `services.buffer_min` (per-service buffer, falls back to the salon's) |
| v3 | `businesses.festival_mode` + overrides; `packages` / `package_credits`; `booking_groups` for family booking |

Every new function → **revoke it from `public, anon, authenticated`** in the same migration, then grant to `service_role` (or add it to the browser allow-list on purpose). Postgres lets everyone execute new functions by default, and the guard test (61) fails if you forget. Every new table → enable RLS + policies (test 01).

## 6. Scheduled jobs (`database/cron.sql`)

| Job | Schedule (UTC) | Does |
|---|---|---|
| `expire-holds` | every minute | `expire_stale_holds()` |
| `send-notifications` | every 5 minutes | pg_net POST → `/api/notifications/send` with `x-notify-secret` |
| `cleanup-rate-events` | daily 03:17 | `cleanup_rate_events()` |
| `auto-complete` | hourly | `auto_complete_bookings()` |
| `release-walkins` | every 5 minutes | `release_stale_walkins()` |
| `reset-demo` | daily 20:43 (≈ 02:13 IST) | resets the demo salon (written in Phase 9) |

pg_cron stops while the project is paused, which is one more reason for the keep-alive (`FREE_TIER.md` §4). Even if the expiry job is late, `create_hold` and `get_free_slots` already ignore expired holds ("lazy expiry"), so customers never see a stale hold blocking a slot.

---

## 7. Migrations workflow

```bash
supabase migration new init               # creates supabase/migrations/<ts>_init.sql
# paste database/schema.sql into it
supabase db reset                         # rebuilds local DB from migrations + seed.sql
supabase test db                          # runs pgTAP tests in supabase/tests/database
supabase db push                          # applies new migrations to the cloud project
```
Then run `database/cron.sql` once in the cloud project's SQL editor, after filling in your app URL and secret.

**Never edit an applied migration.** Make a new one (`supabase migration new add_waitlist`).

---

## 8. Free-tier size check

- 2,000 bookings of history added only milliseconds to the free-slot query (6–7 ms measured, check 43).
- Rough row sizes: a booking is a few hundred bytes. Even 100,000 bookings is in the tens of MB, far below the free plan's 500 MB.
- `rate_events` is the only fast-growing table, which is why it's cleaned daily.

---

# Part 5: Testing Plan
*(was `TESTING.md`)*


Testing is spread across every phase (see `PLAN.md` §7), not left to the end. Phase 8 completes and hardens it. Starter files are in `starter-tests/`. The database design has already passed 62 checks (`FEASIBILITY.md`).

---

## 1. Strategy: what runs where

| Layer | Tool | Runs on | When | Count (target) |
|---|---|---|---|---|
| Database (rules, RLS, functions) | pgTAP via `supabase test db` | Local Supabase + CI | Every change to SQL | 40+ |
| Concurrency (races) | Node script / k6 | **Local only** | Phases 1, 3, 6, 8 | 6 scenarios |
| Unit (pure JS helpers) | Vitest | Local + CI | Every push | 40+ |
| API integration (routes + real local DB) | Vitest + `fetch` | Local | Phases 3–7 | 30+ |
| Webhooks (signed fake events) | Node script | Local | Phase 5 | 6 scenarios |
| End-to-end (real browser) | Playwright | Local; a few against the live demo | Phases 2–7 | 10+ flows |
| Load / stress / spike / soak | k6 | **Local** heavy; live only light smoke | Phase 8 | 5 profiles |
| Bot attack | k6 / Node | Local | Phase 8 | 7 attacks |
| Simulation (fake salon life) | Node scripts + Faker | Local, then a small run on live | Phase 8 | 3 salons × 90 days |
| Manual | You + phone | Live (test mode) | Before each release | checklist §12 |

**Golden rule for the free plan:** heavy tests **never** hit the live site. On Vercel Hobby, going over a usage limit generally means waiting until 30 days have passed. Run them against `localhost` + local Supabase (Docker).

**Test keys so nothing costs money or needs real humans**
- Turnstile: Cloudflare's test **secret** `1x0000000000000000000000000000000AA` always passes; `2x0000000000000000000000000000000AA` always fails. The test **site key** `1x00000000000000000000AA` (visible) or `1x00000000000000000000BB` (invisible) issues the dummy token `XXXX.DUMMY.TOKEN.XXXX`. Production secret keys reject the dummy token.
- Razorpay: test keys (`rzp_test_…`); test UPI `success@razorpay` / `failure@razorpay`.
- Messages: `NOTIFIER=log` locally and in CI; `whatsapp` only on the deployed app, to your verified numbers.

---

## 2. Tools (all free)

| Tool | Install | Purpose |
|---|---|---|
| Supabase CLI + Docker Desktop | per Supabase docs | Local Postgres/Auth; `supabase test db` (pgTAP) |
| Vitest | `npm i -D vitest` | Unit + API tests in plain JS |
| Playwright | `npm init playwright@latest` (choose JavaScript) | Browser tests |
| k6 | download from the k6 website / package manager | Load tests (scripts are JavaScript) |
| @faker-js/faker | `npm i -D @faker-js/faker` | Fake Indian names (`fakerEN_IN`) |

---

## 3. Database tests (pgTAP)

Location: `supabase/tests/database/*.test.sql`. Run: `supabase test db`.
Starter file: `starter-tests/database/01_core.test.sql` (logic checked locally, see `FEASIBILITY.md`).

**Must-have checks** (numbers match `verification/db.test.mjs`):

| # | Check | Why it matters |
|---|---|---|
| 01 | RLS enabled on every public table | One forgotten table = data leak |
| 02–03 | Owner creates salon; anon cannot | Onboarding + permissions |
| 05 | Overlapping working windows rejected | Bad setup can't create ghost slots |
| 06, 32 | Salon B can't read or write salon A | Multi-tenancy |
| 07–09 | Slot count, IST conversion, breaks, closing time, Sunday | The slot engine |
| 11–14 | Same slot taken; buffer overlap; back-to-back allowed; other staff allowed | The constraint |
| 16 | One active hold per customer | Anti-hogging |
| 17 | Break / after-closing / time off / past / too far → rejected | Server-side validation |
| 20 | ₹0-deposit service confirmed instantly | Pay-at-salon mode |
| 21–23 | Payment confirms; duplicate ignored; wrong amount rejected | Idempotent payments |
| 24–26 | Hold expiry; late payment revived; late payment refunded | Money edge cases |
| 27–28 | Cancel with / without refund; double cancel; bad token | Customer self-service |
| 29–31 | Status rules; no-show counter; blocked customer | Business rules |
| 33–35 | Anon reads nothing; payments not writable; staff sees own; walk-in overlap | RLS details |
| 36 | Server-only functions not callable by anon / authenticated | The Supabase function-exposure trap |
| 37–38 | Cross-salon FK refused; bad phone; deposit > price | Data integrity |
| 39 | Max 3 salons per owner | Free-tier abuse guard |
| 41 | Notification retries → failed after 3 | Worker logic |
| 44–46 | ⭐ Smart deposit: regular → **half** (never ₹0); 1 no-show → double; 2+ → full; switch off → normal | Signature feature 2 |
| 47–49 | ⭐ Walk-in: placed after an appointment only if it fits; spreads across free staff; queues back-to-back | Signature feature 1 |
| 51 | ⭐ Walk-in respects an online hold made a moment earlier | Walk-ins and appointments share one calendar |
| 52 | Walk-in and deposit functions not callable from the browser | Permissions |
| 53 | Only the owner can grant ₹0 (trusted); trust lost after a no-show | Abuse safeguard (unverified phones) |
| 54 | Typing someone's phone can't rename them; booking keeps the typed name | Impersonation |
| 55 | Same browser can switch slots; a stranger with the same phone can't release the hold | Hold UX + abuse |
| 56 | `start_payment`: extends once; refuses < 3 min left; checks the browser key | Late-payment prevention |
| 57 | Auto-complete forgotten visits; owner can correct to no-show | Data quality for smart deposits |
| 58–59 | Walk-ins who left are released; one queue place per phone | Queue hygiene |
| 60 | Demo viewer reads everything, changes nothing | Demo vandalism |
| 61 | **GUARD:** no function callable from the browser unless allow-listed; future tables locked | Future-proof permissions |
| 62 | New server functions not callable from the browser | Permissions |

pgTAP runs inside **one** connection, so it **cannot** test races. Keep `verification/db.test.mjs` for checks 18, 19, 40, 42 and 50 (concurrency), pointed at local Supabase:
```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node verification/db.test.mjs
```
(54322 is the usual local Supabase DB port; `supabase status` shows yours.)

---

## 4. Unit tests (Vitest)

`tests/unit/*.test.js`. Run with `TZ=UTC npx vitest run` (forces the same timezone as Vercel).

| Module | Cases |
|---|---|
| `lib/money.js` | `rupeesToPaise`: "199.99"→19999, "100"→10000, "0.05"→5; rejects "-1", "1.234", "abc", "" |
| `lib/razorpay.js` | Webhook signature: valid / tampered body / pretty-printed body / wrong secret / short signature; checkout signature valid / swapped payment ID (copy from `verification/payments.test.mjs`) |
| `lib/time.js` | 04:30Z → "10:00 am" IST under `TZ=UTC`; date picker never offers past dates; day boundaries at 23:30 IST |
| `lib/validation.js` | Phone `^[6-9][0-9]{9}$` (accepts 9876543210; rejects 12345, 5876543210, +919876543210 unless normalised); slug; name length; date format |
| `lib/errors.js` | Every SQL error code → right HTTP status + message; unknown → 500 with a generic message |
| `lib/notifier/*` | Message text contains customer name, IST time, salon name, manage link; `log` notifier stores text |
| `lib/rate-limit.js` | Builds keys `hold:ip:<ip>` / `hold:phone:<phone>`; reads the first IP from `x-forwarded-for` |
| Hours form | End after start; no overlapping windows; lunch break creates two windows |

---

## 5. API integration tests

Run `next dev` against local Supabase with test keys (Turnstile test secret, `NOTIFIER=log`). Use Vitest + `fetch`. Reset the database before the suite (`supabase db reset`).

| Route | Cases |
|---|---|
| `GET /api/slots` | correct list; `staff=any` deduplicated by time; unknown salon → 404; bad date → 400; 121st request in a minute from one IP → 429 |
| `POST /api/hold` | success → `held`; same slot → 409 `SLOT_TAKEN`; `staff=any` falls through to the next free stylist; same browser picking again → old hold released; different browser same phone → 409; missing Turnstile → 403; honeypot filled → 200 but **no row created**; bad phone → 400; 4th hold for one phone in an hour → 429; 21st from one IP → 429 |
| `POST /api/walkin` | wrong / old counter code → 403; previous 10-min window still accepted; second join same phone → 409 `WALKIN_ALREADY_QUEUED` |
| `POST /api/payments/order` | held booking → order; expired hold → 409; confirmed booking → 409; repeat call reuses the same order |
| `POST /api/payments/verify` | good signature → `CONFIRMED`; bad → 400; repeat → `ALREADY_PROCESSED` |
| `POST /api/payments/webhook` | see §6 |
| `GET/POST /api/booking/[token]` | details; cancel → refund flags; bad token → 404 |
| `POST /api/notifications/send` | without secret → 401; with secret → messages logged, rows `sent` |
| `GET /api/keep-alive` | without `Bearer CRON_SECRET` → 401; with → 200 |

---

## 6. Webhook tests (no tunnel needed)

Razorpay can't reach `localhost`, but you don't need it to. Sign your own fake events with your **test** webhook secret, exactly as Razorpay does (HMAC-SHA256 of the raw body). Starter: `starter-tests/webhook/send-fake-webhook.mjs`.

| Scenario | Expected |
|---|---|
| Valid `payment.captured` | 200; booking `confirmed`; 3 notifications |
| Same event sent again | 200; nothing changes (`ALREADY_PROCESSED`) |
| Body tampered after signing | 400; nothing changes |
| Wrong amount | 200 logged as `AMOUNT_MISMATCH`; booking stays `held` |
| Event for an expired hold, slot still free | booking revived → `confirmed` |
| Event for an expired hold, slot taken | payment `refund_pending` → refund call (mocked locally) → `refunded` |

Then **once on the deployed app**: real Razorpay test-mode webhooks to your Vercel URL, checked in the Razorpay dashboard's webhook delivery log.

---

## 7. End-to-end tests (Playwright)

`tests/e2e/*.spec.js`. Razorpay Checkout runs in a third-party iframe, so E2E tests **stub the payment step**: they call `/api/payments/verify` with a self-signed signature, using the test key secret. The real Checkout is covered by the manual checklist (§12).

| Flow | Steps |
|---|---|
| Owner onboarding | sign in (test user) → create salon → add service, staff, hours → booking page shows slots |
| Book ₹0 service | open `/b/slug` → pick slot → details → "Booked" → appears in dashboard |
| Book with deposit | pick → hold timer visible → stubbed payment → "Booked" |
| Hold expiry | pick → fast-forward (set `hold_minutes` to 3 in test salon, or expire via SQL) → "Hold expired" → slot reappears |
| Two browsers, one slot | two contexts click the same slot together → one success, one "slot just booked" |
| Cancel with refund | open manage link → cancel → "refund initiated" → slot reappears |
| No-show | owner marks a past booking no-show → customer page shows count 1 → block → booking with that phone refused |
| Walk-in overlap | owner adds walk-in over an existing booking → clear error |
| Staff view (v2) | staff login sees only own column |
| Mobile | booking flow at 375 px width (Playwright device preset) |
| Smart deposit | seed a regular (3 completed visits) → page shows "Half deposit, thanks for coming back!" and half the amount; owner marks a customer trusted → that customer is confirmed with no payment |
| Hold switch | pick slot A → go back → pick slot B in the same browser → slot A is free again for others |
| Late in the hold | wait until < 3 min remain → press Pay → "please pick the slot again" instead of a risky payment |
| Demo viewer | log in as viewer → every save/delete button disabled or refused |
| Walk-in | phone-sized browser opens `/q/slug` → joins → sees token and wait → token appears on `/q/slug/board` → owner dashboard shows the walk-in badge |
| Hindi page (v2) | switch language → every label translated, times still IST |

---

## 8. Race tests

1. **Database race** (done, `verification/db.test.mjs` check 18): 50 simultaneous `create_hold` → 1 winner, 49 `SLOT_TAKEN`.
2. **Same-phone race** (check 19): one phone, 10 slots at once → exactly 1 hold.
3. **API race:** `starter-tests/load/hold-race.js` (k6): 50 virtual users fire `POST /api/hold` for one slot at the same moment → exactly 1 × 200 and 49 × 409. Afterwards, query the database: one active row.
4. **Worker race** (check 40): two workers claim notifications together → no message claimed twice.
5. **Walk-in rush** (check 50): 15 walk-ins join at the same moment → all placed, zero overlapping pairs. Repeat through the API (`POST /api/walkin`) with k6.
6. **Walk-in vs online** : walk-ins and online holds fired together for the same staff and time window → zero overlaps, and every online winner keeps their slot.

---

## 9. Simulation: proving it works without real customers

**a) History seed** (`scripts/seed-history.mjs`)
- 3 salons, 2–4 staff each, 4–8 services, realistic hours with lunch breaks
- 90 days of past bookings: busier evenings and weekends, ~15% no-shows, ~8% cancellations, repeat customers every 3–6 weeks
- Names from `fakerEN_IN`; phones generated as `9` + 9 random digits (Faker's phone format needs normalising)
- Insert past bookings directly as `completed` / `no_show` / `cancelled` (the status guard only applies to updates)

**b) Bot customers** (`scripts/simulate.mjs`), run against local or a **small** run on the live demo
- every few seconds a "customer" opens slots and holds one:
  - 70% pay (self-signed webhook locally; on live, stop at the hold or use the real test checkout manually)
  - 15% abandon (hold expires)
  - 10% cancel later (half inside, half outside the window)
  - 5% try a slot someone else just took
- Logs a summary: holds, confirmations, expiries, refunds, conflicts, errors

**c) Real humans:** 5–10 friends book the demo salon over a week; their 5 numbers verified on the WhatsApp test number; a short Google Form for feedback.

---

## 10. Load testing (k6)

Starter: `starter-tests/load/booking-load.js`. Pick a profile with `-e PROFILE=...`:

| Profile | Shape | Question | Pass if |
|---|---|---|---|
| `smoke` | 2 users, 1 min | Does the script work? | 0 errors |
| `load` | ramp to 50 users, hold 5 min | Normal busy day OK? | errors < 1%, p95 < 800 ms |
| `stress` | ramp 20 → 50 → 100 → 200 → 300 | Where does it break? | Record the user count where p95 > 1 s or errors > 1%. **That number is your capacity.** |
| `spike` | 10 → 300 users in 10 s, then back | Viral Instagram post? | Recovers within 1 min after the spike; no wrong data |
| `soak` | 30 users for 60 min | Slow decay, connection leaks? | p95 at the end ≈ p95 at the start |

```bash
k6 run -e BASE_URL=http://localhost:3000 -e PROFILE=stress starter-tests/load/booking-load.js
```

**Read three numbers:** `http_req_failed` (error rate), `http_req_duration` p(95), and `http_reqs` (requests/second). Each virtual user `sleep`s between requests like a real person, so 100 users ≠ 100 requests/second.

**Where to run:** stress, spike and soak run **locally only** (your laptop + Docker). On the live demo, run `smoke` and a small `load` (≤ 30 users) only.

**When it breaks**, look at: the slot query plan (`EXPLAIN ANALYZE`), missing indexes, database connections (go through Supabase's API / pooler, never raw direct connections from serverless functions), or a too-chatty page (cache slots for a few seconds). Re-run after each fix and record "before → after" in the README.

---

## 11. Bot-attack test

Starter: `starter-tests/load/bot-attack.js`. Run it **before and after** adding protections, against local.

| Attack | Without protection | With protection (expected) |
|---|---|---|
| Slot hogging: hold every slot of the day from one IP with random phones | all slots held | ≤ 20 holds per hour per IP (generous for shared mobile IPs), Turnstile required, 7-min holds; record how many slots stay free |
| Same phone holds many slots | many holds | 1 hold |
| No Turnstile token | succeeds | 403 |
| Honeypot filled | succeeds | silent fake success, nothing stored |
| Flood `/api/slots` (300 requests per minute from one IP) | all served | 429 after 60 |
| Forged webhook ("payment captured", no valid signature) | booking confirmed for free | 400, nothing changes |
| Queue flooding: fake walk-ins from home | queue full of fakes | Rejected without the current counter code; 1 active per phone; Turnstile |
| Release someone's hold by typing their phone | hold released | Refused (different browser key) |
| Book as a regular to get a cheap deposit | ₹0 booking | At most half deposit; ₹0 only for owner-trusted customers |

Put the before/after numbers in the README.

---

## 12. Security checks and manual release checklist

**Security (run each before Phase 9)**
- [ ] Service-role key appears **only** in server files (`grep -r SERVICE_ROLE app lib` shows only `lib/supabase/admin.js`); no `NEXT_PUBLIC_` on secrets
- [ ] Production JS bundle has no secrets: search the `.next/static` output for `rzp_test_` key secret, the service key's first characters, the Turnstile secret
- [ ] Using only the public anon key from the browser console: cannot read bookings or customers; cannot call `create_hold` / `confirm_payment` via RPC
- [ ] Webhook with a bad signature → 400
- [ ] `/api/notifications/send` and `/api/keep-alive` without secrets → 401
- [ ] Manage-page tokens are UUIDs (not guessable sequential IDs)
- [ ] Error responses never contain SQL text or stack traces

**Manual checklist on the deployed app (test mode)**
- [ ] Book with test UPI `success@razorpay` → confirmed; WhatsApp confirmation arrives on your phone
- [ ] Book with `failure@razorpay` → not confirmed; hold expires; slot reappears
- [ ] Close the tab right after paying → webhook still confirms (check the dashboard)
- [ ] Cancel > 24 h ahead → Razorpay dashboard shows a test refund
- [ ] Book a slot ~2 h 10 min ahead → 2 h reminder arrives on time (IST)
- [ ] Demo login works; demo resets overnight
- [ ] Phone browser: whole flow usable at small width
- [ ] After 8+ days of no visits: site still up (keep-alive working)

---

## 13. Results table (copy into README "Proof" section)

| Test | Result |
|---|---|
| Database tests (pgTAP) | __ / __ passing |
| Unit tests | __ / __ passing |
| API integration tests | __ / __ passing |
| E2E flows | __ / __ passing |
| Race: 50 parallel holds, one slot | __ booking(s) created (must be 1) |
| Race: 1 phone, 10 slots | __ hold(s) (must be 1) |
| Walk-in rush: 15 at once | __ placed, __ overlaps (must be 0) |
| Smart deposit | regulars paid half: yes/no; owner-trusted paid ₹0: yes/no; repeat no-show paid full: yes/no |
| Load: 50 users | p95 __ ms, errors __ % |
| Stress: capacity (**local laptop only**, not production) | ~__ concurrent users at p95 < 1 s |
| Spike: 10 → 300 users | recovered in __ s, data correct: yes/no |
| Soak: 60 min | p95 start __ ms → end __ ms |
| Bot attack: slot hogging | before: __ slots held → after: __ |
| Simulation | 3 salons, 90 days, __ bookings, __ refunds, __ conflicts handled |
| Free-slot query on __ bookings | __ ms |

---

## 14. Continuous integration (GitHub Actions, free on public repos)

`.github/workflows/ci.yml` on every push and pull request:
1. `npm ci`
2. `npm run lint`
3. `TZ=UTC npx vitest run tests/unit`
4. Database: `supabase/setup-cli` action → `supabase start` → `supabase test db`
5. (optional) Playwright against `next build && next start` with local Supabase

Load tests, bot attacks and the simulation are **not** in CI. They're run by hand, and their results go in the README.

---

# Part 6: Zero-Budget (Free Tier) Guide
*(was `FREE_TIER.md`)*


## 1. The rules
1. **Never add a credit/debit card** to any account in this project. If a signup insists on a card, stop and find another way.
2. **Test modes only:** Razorpay test keys (`rzp_test_…`) and the WhatsApp **test** number.
3. **Heavy testing happens locally** (Docker + local Supabase), never against the live site.
4. Before adding any new service, check its free plan and write it in the table below.
5. Once a month, run the checklist in §6.

## 2. Every service and its free limits (checked 21 Oct 2026)

| Service | Free plan | Limits that matter to us | Our usage |
|---|---|---|---|
| **Vercel** Hobby | Free | **Non-commercial, personal use only.** Going over a usage limit generally means waiting 30 days for that feature. Cron jobs: **once per day** max, timing ±59 min. | Portfolio demo = fine. One daily cron (keep-alive). |
| **Supabase** Free | Free | 500 MB database, 1 GB file storage, 5 GB bandwidth, 50,000 monthly active users, **2 active projects**, **paused after 1 week of inactivity**. Built-in auth email ≈ **2 per hour**. | A few MB of data. One project. Google sign-in instead of email. Keep-alive (§4). |
| **pg_cron + pg_net** | Included in Supabase Free | pg_cron stops while the project is paused | Hold expiry, reminders, cleanup |
| **Razorpay** | Test mode needs no KYC; usable indefinitely | No real money; live mode needs KYC + per-transaction fees | Test mode only |
| **WhatsApp Cloud API** | Free test number; template sends need no payment method | **Only 5 verified recipient numbers**; free-form text only within 24 h of the customer messaging you; templates need Meta review | You + up to 4 testers |
| **Cloudflare Turnstile** | Free | Up to 20 widgets; unlimited challenges | 1 widget |
| **GitHub** | Free public repos + Actions | Scheduled workflows in public repos are **disabled after 60 days with no repo activity** | CI + backup keep-alive |
| **Google Cloud** | OAuth client is free (no billing account needed for sign-in) | — | Owner Google sign-in |
| **Docker Desktop / Supabase CLI / k6 / Playwright / Vitest** | Free (Docker Desktop is free for personal use; check Docker's current terms) | Your laptop's RAM/CPU | Local development and heavy tests |

## 3. Traps and their fixes

| Trap | What happens | Fix (already in the plan) |
|---|---|---|
| Supabase pause | After a quiet week the demo shows a blank screen; pg_cron jobs stop | Two keep-alives (§4) |
| Supabase email limit | Sign-up / reset emails silently stop after ~2 per hour | Google sign-in for owners; demo user created by hand in the dashboard |
| Vercel Hobby cron is daily only | Can't run reminders every 5 min from Vercel | Reminders run from **pg_cron + pg_net** inside Supabase |
| Load testing the live site | Can exceed Hobby limits → feature locked for up to 30 days | Heavy tests only on `localhost` |
| WhatsApp 5-recipient limit | Messages to other numbers fail (error 131030) | Add testers' numbers; everyone else gets the `log` notifier |
| WhatsApp temporary token | Expires quickly; reminders start failing | Create a permanent system-user token (free) in Meta Business settings |
| GitHub backup cron disabled | After 60 days without commits | The Vercel daily cron is the primary; re-enable the workflow if GitHub emails you |
| **No free Supabase slot left** | The free plan allows 2 active projects. Velanthe already uses one; if Skillsight's Postgres is also on Supabase, both are taken | Decide in Phase 0: move one older project's database elsewhere, or share one project (separate schemas). Don't pause a project that's live on your resume, because a paused project means a dead demo |
| `rate_events` table growth | Free 500 MB slowly fills | Daily cleanup job |
| Custom domain | Costs money | Use `*.vercel.app` |

## 4. Keep-alive (the demo must work on any day)

**Primary: Vercel daily cron (never auto-disabled)**
`vercel.json`:
```json
{ "crons": [ { "path": "/api/keep-alive", "schedule": "13 2 * * *" } ] }
```
`app/api/keep-alive/route.js`: check `Authorization: Bearer ${process.env.CRON_SECRET}`, then make one small real query through Supabase (e.g. `select id from businesses limit 1`) and return 200. Vercel sends `CRON_SECRET` as a Bearer header automatically when the variable is set.

**Backup: GitHub Actions every 3 days**
`.github/workflows/keep-alive.yml`: `on: schedule: - cron: '0 6 */3 * *'` → `curl` your `/api/keep-alive` with the secret (store it in GitHub repository secrets). Note that it is disabled after 60 days without repository activity.

Both are idempotent: Vercel says cron delivery can occasionally be missed or duplicated, and a duplicate ping is harmless.

## 5. Things that would cost money (and why we don't need them)

| Paid thing | Why we skip it |
|---|---|
| Supabase Pro (no pause) | Keep-alive solves it |
| Vercel Pro (frequent crons, commercial use) | pg_cron does frequent jobs; the project is non-commercial |
| Razorpay live mode | Demo only; test mode proves the integration |
| WhatsApp production number + per-message charges | 5 test recipients are enough to demonstrate |
| SMS (MSG91 etc., DLT registration) | WhatsApp only |
| Paid email (custom SMTP with a domain) | Google sign-in, no emails needed |
| Custom domain | `*.vercel.app` is fine for a portfolio |

## 6. Monthly checklist
- [ ] Open the live demo: does it load and book?
- [ ] Supabase dashboard: database size, bandwidth; project not paused
- [ ] Vercel dashboard: usage well under limits; cron ran (logs)
- [ ] GitHub: keep-alive workflow still enabled
- [ ] Meta: WhatsApp token still valid (send yourself a test reminder)
- [ ] No card added to any account

## Sources
- Vercel Hobby plan: https://vercel.com/docs/plans/hobby
- Vercel fair use (commercial): https://vercel.com/docs/limits/fair-use-guidelines
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel cron security and delivery: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Supabase free tier limits: https://automationatlas.io/answers/supabase-free-tier-limits-2026/
- Supabase pausing / keep-alive: https://levelup.gitconnected.com/supabase-free-tier-will-pause-your-app-heres-the-github-actions-fix-8c1fd35b49ca
- pg_cron on all plans: https://www.rapidevelopers.com/md/supabase-tutorial/how-to-schedule-cron-jobs-with-supabase
- pg_net: https://supabase.com/docs/guides/database/extensions/pg_net
- Supabase built-in email limit: https://sendlayer.com/blog/supabase-custom-smtp-and-email-configuration-guide/
- Razorpay test vs live mode: https://razorpay.com/docs/payments/quickstart.md
- WhatsApp Cloud API test number: https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/
- WhatsApp test recipients / error 131030: https://docs.weweb.io/integrations/whatsapp.html
- Cloudflare Turnstile plans: https://developers.cloudflare.com/turnstile/plans/
- GitHub scheduled workflow 60-day rule: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows

---

# Part 7: Security and Abuse Protection
*(was `SECURITY.md`)*


## 1. Threats and controls

| # | Threat | Control | Where | Proven? |
|---|---|---|---|---|
| 1 | Bot holds every slot without paying (slot hogging) | Turnstile on hold; 3/hour per phone; generous 20/hour per IP; **1 active hold per customer** (unique index); short holds (7 min) | `/api/hold`, `create_hold` | Index + race: checks 16, 19 |
| 2 | Double booking under load | Exclusion constraint `no_double_booking` | Database | Checks 11–14, 18 (50 parallel → 1) |
| 3 | Flooding APIs (and burning free-tier limits) | `check_rate()` per IP/phone; Vercel firewall rules (Hobby: up to 3 custom rules, 10 IP blocks) | API routes | Rate limiter: check 42 |
| 4 | Fake walk-ins filling the queue / joining from home | **Rotating counter code** shown only on the salon's signed-in screen (10-min windows); Turnstile; 1 active place per phone; auto-release after 30 min | `/api/walkin`, `join_walkin_queue` | Checks 47–51, 58, 59 |
| 5 | Salon A reads salon B's data | RLS on every table; composite FKs | Database | Checks 01, 06, 32, 37 |
| 6 | Anyone with the public key reads tables directly | RLS + `revoke all … from anon` | Database | Check 33 |
| 7 | Browser calls server-only functions via RPC (`confirm_payment`, `create_hold`) | `revoke execute … from public, anon, authenticated`; grant to `service_role` only; **guard test** fails if any function outside the allow-list is callable (new functions are callable by everyone by default in Postgres) | `schema.sql` §6–7 | Checks 36, 52, 61, 62 |
| 8 | Fake "payment captured" webhook | HMAC-SHA256 on the **raw** body with the webhook secret; constant-time compare | `/api/payments/webhook` | `payments.test.mjs` 01–05 (matches official SDK) |
| 9 | Tampered checkout callback | HMAC of `order_id|payment_id` with the key secret | `/api/payments/verify` | `payments.test.mjs` 06 |
| 10 | Duplicate / replayed webhooks | Unique `razorpay_payment_id`; row lock in `confirm_payment` | Database | Check 22 |
| 11 | Wrong amount paid | `confirm_payment` compares amount in paise | Database | Check 23 |
| 12 | Staff edits other staff's bookings | RLS `bk_update` scoped to own `staff_id` | Database | Check 34 |
| 13 | Illegal booking changes (reviving cancelled, completing future) | `bookings_guard` trigger | Database | Check 29 |
| 14 | Guessing someone's manage link | Random UUID tokens; rate-limited lookups | `/booking/[token]` | Token type: check 48 |
| 15 | Anyone triggering the reminder or keep-alive routes | `x-notify-secret` / `Bearer CRON_SECRET` checks | API routes | Manual (TESTING §12) |
| 16 | Secret keys leaked to the browser | Never `NEXT_PUBLIC_` on secrets; `import 'server-only'` in the admin client; scan the build output | Code | Manual (TESTING §12) |
| 17 | Owner creates hundreds of salons (free-tier abuse) | Max 3 salons per owner | `create_business` | Check 39 |
| 18 | Database error text leaking internals | Named errors mapped in `lib/errors.js`; generic 500 | API | Unit tests |
| 19 | Honeypot-able form bots | Hidden `website` field; if filled → fake success, nothing stored | `/api/hold`, `/api/walkin` | API tests |
| 20 | **Impersonation (phones are not verified)**: booking with someone else's number to get their cheaper deposit, rename them, or spam them | History gives at most a half deposit; ₹0 only for owner-trusted customers; saved names never overwritten; reminders only after a booking is confirmed | `deposit_for`, `create_hold` | Checks 44, 53, 54 |
| 21 | Releasing someone else's hold by typing their phone | Holds can only be replaced by the same browser (`hold_key`) | `create_hold` | Check 55 |
| 22 | Paying with seconds left → refund disputes | `start_payment`: refuse < 3 min, extend once to 10 min | `/api/payments/order` | Check 56 |
| 23 | Demo vandalism | Read-only `viewer` role; nightly reset | RLS | Check 60 |
| 24 | Real users blocked by shared IPs (mobile networks, salon Wi-Fi) | IP limits kept generous; phone-based limits do the real work | API | API tests |

## 2. Rate limits (starting values; tune after the bot-attack test)

| Key | Limit |
|---|---|
| `slots:ip:<ip>` | 120 per minute |
| `hold:phone:<phone>` | 3 per hour (the strict one) |
| `hold:ip:<ip>` | 20 per hour (generous: many Indian mobile users share one IP) |
| `order:ip:<ip>` | 30 per hour |
| `walkin:ip:<ip>` | 30 per hour (salon Wi-Fi = many customers on one IP; the counter code does the real work) |
| `manage:ip:<ip>` | 30 per minute (lookups), 5 per hour (cancels) |

Client IP on Vercel: the first entry of the `x-forwarded-for` header. Shared IPs are common in India (carrier NAT, salon Wi-Fi), so never rely on IP limits alone.

## 3. Secrets handling
- Secrets live only in Vercel environment variables and your `.env.local` (git-ignored **before** the first commit).
- The service-role key is used in exactly one file: `lib/supabase/admin.js`.
- If a secret is ever committed: **rotate it** in the provider's dashboard. Deleting the file doesn't remove it from history.
- Use different secrets for local and deployed environments.

## 4. Privacy (customer phone numbers are personal data)
- Phone numbers are **not verified** in this ₹0 version. A real launch would add OTP (paid) before trusting history.
- Collect only name + phone. No email, no address, no date of birth.
- The queue board shows masked names ("R*** S.") and never phone numbers.
- A short `/privacy` page: what is stored, why (bookings and reminders), how long, how to ask for deletion.
- Suggested retention: anonymise customers with no visit in 2 years (a v2 cron job).
- Treat client notes as business notes. Avoid storing health details; for patch tests (v3), store only a yes/no flag.
- India's Digital Personal Data Protection Act, 2023 applies to real deployments. For this demo, keep data minimal and the privacy page honest.

## 5. Demo safety
- The demo salon is flagged `is_demo` and reset nightly.
- The demo login is a **viewer** (read-only) of the demo salon only; it can't change anything (check 60).
- The demo uses Razorpay **test** keys and the `log` notifier for numbers outside the 5 verified ones.

## 6. Pre-launch security checklist
See `TESTING.md` §12. All boxes must be ticked before sharing the link.

---

# Part 8: Feasibility Report
*(was `FEASIBILITY.md`)*


**Question:** can this project really be built, with these features, on free plans, by one developer using Next.js (JavaScript) + Supabase?

**Answer:**
- **As a deployed portfolio demo: yes.** Every risky part was built and tested on a real PostgreSQL database, and free-plan facts were checked against official docs (21 Oct 2026).
- **As a real product for real salons: not as-is.** That needs paid or regulated pieces (`PLAN.md` §0). The plan is honest about this, and so should your resume be.

---

## 1. What was tested, and how

**Environment:** PostgreSQL 16.15 + `verification/supabase_shim.sql` (imitates Supabase's `auth` schema, the `anon` / `authenticated` / `service_role` roles and their default grants); Node.js 22; npm `pg` 8.x, `razorpay` 2.9.x (official SDK, used only to cross-check signatures).

| Suite | File | Result |
|---|---|---|
| Database design: constraint, RLS, functions, triggers, permissions, races, signature features, review fixes | `verification/db.test.mjs` | **62 / 62 pass** |
| Payment signatures, money conversion, IST on a UTC server | `verification/payments.test.mjs` | **9 / 9 pass**; signatures **agree with the official Razorpay SDK** |
| Starter pgTAP file (Supabase format) | `starter-tests/database/01_core.test.sql` | **12 / 12 pass** (local pgTAP stand-in; Supabase has real pgTAP) |
| Webhook sender | `starter-tests/webhook/send-fake-webhook.mjs` | valid → accepted; duplicate → ignored; tampered → 400; wrong amount → flagged (mock server) |
| k6 scripts | `starter-tests/load/*.js` | **Syntax-checked only.** k6 couldn't be downloaded in the test environment; you run them in Phase 8 |

### Highlights
| What | Result |
|---|---|
| 50 people grab the same slot at once | exactly **1** booking |
| One phone tries 10 slots at once | exactly **1** hold |
| 15 walk-ins at once | all placed, **0 overlaps** |
| Walk-in vs an online hold made a moment earlier | walk-in goes after the hold |
| Late payment for a slot someone else took | `REFUND_NEEDED`; the other customer is unaffected |
| Same webhook twice | second is `ALREADY_PROCESSED` |
| Salon B reading or changing salon A | 0 rows seen, 0 changed |
| Demo viewer trying to change anything | 0 rows changed / refused |
| Smart deposit on a ₹300 service with ₹100 deposit | regular ₹50 · new ₹100 · 1 no-show ₹200 · 2+ ₹300 · owner-trusted ₹0 |
| Someone typing a regular's phone | can't rename them, can't release their hold, can't get ₹0 |
| Paying with < 3 min left | refused before payment (no refund mess) |
| Free-slot query with 2,000+ past bookings | **about 4–7 ms** |

### Do the tests catch mistakes? (mutation testing on the final schema)
| Deliberate break | Tests that failed (caught it) |
|---|---|
| Removed the `no_double_booking` constraint | 11, 12, 18, 26, 35 |
| Turned off RLS on `bookings` | 01, 32, 34, 35, 60 |
| Let `anon` call `create_hold` | 36, 61 |
| Removed the one-hold-per-customer index | 16, 19, 55, 56 |
| Made payments readable by any logged-in user | 32 |

---

## 2. What the design review found (and what was done)

| Finding | Severity | Outcome |
|---|---|---|
| "No one combines walk-ins + appointments" was **wrong**: Waitwhile does | Critical (honesty) | All wording corrected; positioned as "different for Indian salons" |
| Unverified phones let anyone get a regular's ₹0 deposit | Critical | History gives half; ₹0 only for owner-trusted (tests 44, 53) |
| Single Razorpay account can't legally collect for many salons | Critical (real life) | Test mode only; go-live path documented |
| WhatsApp can't reach recruiters | Critical (demo) | Everything shown on screen; WhatsApp is a bonus |
| Customer name overwritten by strangers | Major | Fixed (test 54) |
| Customers locked out by their own hold | Major | Same-browser replace (test 55) |
| Paying near hold expiry → refunds | Major | `start_payment` (test 56) |
| Smart deposits need owners to mark visits | Major | Auto-complete (test 57) |
| Walk-ins who leave / join from home | Major | Release + counter code (tests 58, 59) |
| Demo vandalism | Major | Viewer role (test 60) |
| Per-IP limits block shared mobile/Wi-Fi IPs | Major | Phone-based limits; generous IP limits |
| Scope too big | Major | Slices A–E |
| **Found while testing the fixes:** a schema-level revoke cannot stop Postgres from letting everyone run *new* functions, and a global revoke would also break extension functions such as pgTAP | Major | Guard test 61 instead (it immediately flagged ~190 extension functions installed in the wrong schema, fixed by installing `btree_gist` into the `extensions` schema, as Supabase does) |

---

## 3. Facts checked online (21 Oct 2026)

| Claim the plan depends on | Source |
|---|---|
| Vercel Hobby: free, non-commercial; over-limit generally means a 30-day wait | vercel.com/docs/plans/hobby |
| Vercel Hobby cron: once per day, ±59 min; `CRON_SECRET` sent as Bearer; delivery can be missed or duplicated | vercel.com/docs/cron-jobs/usage-and-pricing, …/manage-cron-jobs |
| Supabase Free: 500 MB DB, 2 active projects, pauses after 1 week idle | automationatlas.io (May 2026); multiple guides |
| pg_cron on all plans; pg_net can call URLs from pg_cron | Supabase pg_net docs; tutorials |
| Supabase built-in auth email ≈ 2 per hour | SendLayer / Sequenzy guides |
| `supabase test db` runs pgTAP incl. RLS tests | supabase.com/docs/guides/local-development/testing/overview |
| Razorpay test mode without KYC; test UPI `success@razorpay` / `failure@razorpay` | razorpay.com/docs/payments/quickstart |
| WhatsApp test number: up to 5 verified recipients | developers.facebook.com/docs/whatsapp/cloud-api/get-started |
| Turnstile free (20 widgets, unlimited challenges); test keys + dummy token | developers.cloudflare.com/turnstile/plans, …/troubleshooting/testing |
| GitHub disables scheduled workflows after 60 days with no repo activity | docs.github.com (disable-and-enable-workflows) |
| Waitwhile: walk-ins + appointments in one calendar | waitwhile.com/salon-hairdresser-waitlist |

---

## 4. Known limits we accept
- **Wait estimates** assume services run on time (v2: re-estimate from actual start times).
- **Lazy hold expiry:** an expired hold blocks a slot until the next booking attempt for that stylist, or the 1-minute cron. Customers never see it.
- **Walk-ins** are placed one at a time per salon (advisory lock); today only.
- **The counter code** can be photographed and shared; it only stays valid for up to 20 minutes.
- **Not yet prototyped** (design only): waitlist, family booking, festival mode, packages. Each needs its own migration + tests.

## 5. Still to confirm with your own accounts (each has a fallback)
| Unknown | When | Fallback |
|---|---|---|
| Free Supabase slot available (Velanthe already uses one) | Phase 0 | Move an older project's DB elsewhere, or share one project |
| Schema runs unchanged on Supabase cloud (Postgres 15/17) | Phase 1 | Standard features only; extensions go in the `extensions` schema |
| Inserting test users into `auth.users` with only `id, email` | Phase 1 | Supabase's test-helper package |
| `db.test.mjs` against local Supabase | Phase 1 | Plain Postgres 16 in Docker + the shim (how this report was produced) |
| Google sign-in setup | Phase 2 | Email + password users created in the dashboard |
| Razorpay webhooks reach your **production** URL | Phase 5 | The checkout callback route also confirms |
| WhatsApp template approval time | Phase 7 | `hello_world` template + `log` notifier |
| Real k6 numbers | Phase 8 | Database race results already prove correctness |

## 6. Re-run the checks yourself
```bash
# Plain PostgreSQL 16 (what this report used), e.g. `docker run -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 postgres:16`
psql -h localhost -U postgres -c "create database salontest"
psql -h localhost -U postgres -d salontest -f verification/supabase_shim.sql
psql -h localhost -U postgres -d salontest -f database/schema.sql
cd verification && npm install
DATABASE_URL=postgresql://postgres@localhost:5432/salontest node db.test.mjs
TZ=UTC node payments.test.mjs
```
`db.test.mjs` inserts test data: use a fresh database, never your cloud project. Re-run after every schema change.
