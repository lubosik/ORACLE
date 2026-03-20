# ORACLE

**Outreach Research Autonomous Campaign Learning Engine**

ORACLE is a fully autonomous cold email outreach system for AIRO (Velto AI). It scrapes real estate and high-inbound sales leads, enriches them with Grok, verifies emails via Instantly, generates Claude-personalised 4-email sequences, launches campaigns, and self-optimises using Karpathy-style A/B experiments — autonomously, nightly.

---

## Architecture

```
Apify (lead scrape)
  → Supabase dedup (30-day cooldown)
  → Grok xAI (company enrichment + personalisation hook)
  → Instantly (email verification)
  → Claude (personalised 4-email copy)
  → Instantly (campaign creation + lead upload + activate)
  → Telegram (pipeline report)

Every 6 hours:
  → Score pending experiments (vs baseline, min 150 sends, +0.5pp threshold)
  → Claude generates next hypothesis
  → New pipeline cycle runs with new variant

Every 2 hours:
  → Analytics poll from Instantly → Supabase cache

On reply webhook:
  → Claude drafts reply
  → Telegram: Approve / Edit / Skip
  → Instantly sends approved reply
```

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values
```

### 3. Run Supabase schema
Copy `supabase/schema.sql` and run it in your Supabase SQL editor.

### 4. Run locally
```bash
npm start
# or for dev with watch:
npm run dev
```

Dashboard: `http://localhost:3000`
Mobile: `http://localhost:3000/mobile`
Health: `http://localhost:3000/health`

---

## Environment Variables

| Variable | Description |
|---|---|
| `APIFY_API_TOKEN` | Apify API token for lead scraping |
| `APIFY_ACTOR_ID` | Default: `cdTI90GLKIsTHSjgE` (Apollo.io scraper) |
| `XAI_API_KEY` | xAI Grok API key for enrichment |
| `INSTANTLY_API_KEY` | Instantly.ai API key |
| `INSTANTLY_BASE_URL` | Default: `https://api.instantly.ai/api/v2` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID for notifications |
| `DAILY_LEAD_LIMIT` | Max leads per pipeline run (default: 200) |
| `EXPERIMENT_WINDOW_DAYS` | Days before scoring an experiment (default: 7) |
| `MIN_SENDS_TO_SCORE` | Min sends before scoring (default: 150) |
| `WINNER_THRESHOLD_PP` | Win margin in decimal pp (default: 0.005 = 0.5pp) |
| `VSL_URL` | AIRO VSL link (default: https://airo.velto.ai/) |
| `CALENDLY_URL` | Booking link for discovery calls |
| `PORT` | Dashboard port (default: 3000) |
| `LOG_LEVEL` | Winston log level (default: info) |

---

## Cron Schedule

| Job | Schedule | Description |
|---|---|---|
| Pipeline | `0 1 * * *` | 01:00 UTC nightly |
| Experiment scoring + loop | `0 */6 * * *` | Every 6 hours |
| Analytics poll | `0 */2 * * *` | Every 2 hours |

---

## Railway Deploy

```bash
railway login
railway link
railway up
```

Set all env vars in Railway dashboard before deploying.

After deploy, register the reply webhook:
```bash
node -e "import('./src/pipeline/launcher.js').then(m => m.registerReplyWebhook())"
```

---

## Running Tests

```bash
# Individual modules (requires .env populated)
node tests/test_deduplicator.js
node tests/test_scraper.js
node tests/test_enricher.js
node tests/test_copywriter.js
node tests/test_launcher.js
node tests/test_verifier.js
```

---

## The Experiment Loop

ORACLE runs Karpathy-style self-improvement. Every 6 hours:

1. Reads the experiment ledger (last 10 results)
2. Reads the current baseline positive reply rate
3. Claude proposes a single testable hypothesis (change type, what changed, why)
4. Hypothesis is logged to `experiment_ledger` with `outcome: pending`
5. Pipeline runs with new variant ID
6. After `EXPERIMENT_WINDOW_DAYS`, if `sends >= MIN_SENDS_TO_SCORE` and `delta >= WINNER_THRESHOLD_PP`, variant is promoted to baseline
7. Telegram notifies on every scoring decision

The loop never stops. If it runs out of ideas, it re-reads the ledger and recombines winning elements.

---

## Copy Rules (Non-Negotiable)

- No em dashes anywhere
- No "just following up" or "I wanted to reach out"
- Email 1 subject: first name only or company name only
- Email 2: must include `[VOICE RECORDING 1]` and `[VOICE RECORDING 2]`
- Email 3: must reference 30,000 calls and 391% stat
- Email 4: under 60 words, "Just a yes or no is fine"
- All subject lines: lowercase, under 5 words
- No bullet points in emails 1, 2, or 4
- Tone: peer to peer, never vendor to prospect

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `seen_leads` | Global dedup with 30-day cooldown |
| `lead_enrichment` | Grok enrichment output |
| `lead_verification` | Instantly verification results |
| `lead_copy` | Claude-generated copy per lead |
| `experiment_ledger` | A/B experiment log with outcomes |
| `baselines` | Current best variant per vertical |
| `campaign_daily_stats` | Analytics cache from Instantly |
| `pipeline_runs` | Run log with step counts |
| `reply_log` | Inbound reply drafts and actions |

---

*ORACLE is watching. The crystal ball never stops spinning.*
