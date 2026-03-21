import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.65;
    color: #1a1a2e;
    background: #fff;
    padding: 48px 56px;
    max-width: 900px;
    margin: 0 auto;
  }
  .cover {
    text-align: center;
    padding: 60px 0 80px;
    border-bottom: 3px solid #e63946;
    margin-bottom: 48px;
  }
  .cover h1 {
    font-size: 42px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #e63946;
    margin-bottom: 8px;
  }
  .cover .sub {
    font-size: 13px;
    letter-spacing: 0.18em;
    color: #666;
    text-transform: uppercase;
    margin-bottom: 32px;
  }
  .cover .tagline {
    font-size: 16px;
    color: #333;
    max-width: 520px;
    margin: 0 auto;
    line-height: 1.7;
  }
  .cover .date {
    margin-top: 24px;
    font-size: 11px;
    color: #999;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  h2 {
    font-size: 19px;
    font-weight: 700;
    color: #e63946;
    margin: 36px 0 14px;
    padding-bottom: 6px;
    border-bottom: 1.5px solid #f0e0e2;
    page-break-after: avoid;
  }
  h3 {
    font-size: 14px;
    font-weight: 700;
    color: #1a1a2e;
    margin: 22px 0 8px;
    page-break-after: avoid;
  }
  p { margin-bottom: 10px; }
  ul, ol { margin: 8px 0 12px 22px; }
  li { margin-bottom: 5px; }
  strong { color: #1a1a2e; font-weight: 700; }
  em { color: #555; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0 20px;
    font-size: 12px;
  }
  th {
    background: #f7f0f1;
    color: #e63946;
    font-weight: 700;
    text-align: left;
    padding: 9px 12px;
    border: 1px solid #e8d8da;
    letter-spacing: 0.05em;
    font-size: 11px;
    text-transform: uppercase;
  }
  td {
    padding: 8px 12px;
    border: 1px solid #ebebeb;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #fafafa; }
  .section { page-break-inside: avoid; }
  .callout {
    background: #fff7f7;
    border-left: 4px solid #e63946;
    padding: 12px 16px;
    margin: 14px 0;
    border-radius: 0 6px 6px 0;
    font-size: 12.5px;
  }
  .module-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin: 14px 0 20px;
  }
  .module {
    background: #f9f9f9;
    border: 1px solid #e8e8e8;
    border-radius: 8px;
    padding: 14px 16px;
  }
  .module .module-name {
    font-weight: 700;
    font-size: 13px;
    color: #e63946;
    margin-bottom: 4px;
  }
  .module .module-freq {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #999;
    margin-bottom: 6px;
  }
  .module p { font-size: 12px; margin: 0; color: #444; }
  .abort-table td:first-child { font-weight: 600; color: #c0392b; }
  .footer {
    margin-top: 60px;
    padding-top: 18px;
    border-top: 1px solid #eee;
    font-size: 10px;
    color: #bbb;
    text-align: center;
    letter-spacing: 0.08em;
  }
</style>
</head>
<body>

<div class="cover">
  <h1>ORACLE</h1>
  <div class="sub">Outreach Research Autonomous Campaign Learning Engine</div>
  <div class="tagline">A plain English guide to every feature, how the system learns, and what happens when you switch it on.</div>
  <div class="date">System Guide &mdash; March 2026</div>
</div>

<h2>What Is ORACLE?</h2>
<p>ORACLE is a fully autonomous cold outreach engine. Once switched on, it researches prospects, writes email campaigns, tests them scientifically, learns from every result, and continuously improves itself — without manual work. It targets B2B companies (currently the real estate vertical) with a 4-step cold email sequence sent through Instantly.ai.</p>
<p>Think of it as having a full-time growth researcher who never sleeps: scraping leads, writing copy, running experiments, and rewriting the playbook every time it learns something new.</p>

<h2>The Single On/Off Switch</h2>
<p>The toggle in the top-right corner of the dashboard is the <strong>only</strong> control you need. It writes directly to the database and every scheduled job checks it before doing anything. When it is <strong>OFF</strong>, nothing runs — no scraping, no sending, no research cycles.</p>

<h2>What Happens When You Switch It ON</h2>
<p>Nothing fires instantly — ORACLE runs on a schedule. Here is what kicks in over the next 24 hours:</p>
<table>
  <tr><th>When</th><th>What runs</th></tr>
  <tr><td>Next even hour (e.g. 02:00, 04:00 UTC)</td><td>Analytics pulled from Instantly — opens, replies, bounces</td></tr>
  <tr><td>Even hour + 30 min</td><td>Deliverability check against 7-day averages</td></tr>
  <tr><td>Every 4 hours</td><td>Reply classification &amp; early abort check</td></tr>
  <tr><td>Every 6 hours</td><td>Experiment scoring + new hypothesis generation</td></tr>
  <tr><td>Every 8 hours</td><td>Step attribution analysis</td></tr>
  <tr><td>Every 12 hours</td><td>ICP refinement + cohort analysis</td></tr>
  <tr><td>01:00 UTC daily</td><td><strong>Main pipeline</strong> — scrape → write copy → create draft → Telegram approval request</td></tr>
  <tr><td>03:00 UTC daily</td><td>Winner synthesis</td></tr>
  <tr><td>Mon / Wed / Fri 04:00 UTC</td><td>Program evolution (rewrites the playbook)</td></tr>
  <tr><td>Sunday 05:00 UTC</td><td>Vertical expansion research</td></tr>
</table>

<h3>The First Pipeline Run (01:00 UTC)</h3>
<ol>
  <li>Picks the current geo group (starts with UK) and scrapes Apollo.io city by city until it has 1.5× the minimum lead target</li>
  <li>Loads the current experiment hypothesis, or uses the baseline if none exists</li>
  <li>Claude writes 4 emails — subject, body, and personalisation hook — for the variant</li>
  <li>Creates a draft in the database with all leads, copy, and sending inboxes attached</li>
  <li>Sends you a Telegram message: campaign details and an approve / reject prompt</li>
  <li>You reply to approve. The campaign goes live in Instantly within seconds.</li>
</ol>

<h2>The Experiment Loop (Karpathy Self-Improvement)</h2>
<p>This is the core intelligence of ORACLE — automated A/B testing that directs itself.</p>
<div class="callout"><strong>Baseline:</strong> A proven outreach approach stored in <em>program.md</em>. All new hypotheses are improvements on this starting point. The baseline evolves as winners accumulate.</div>

<h3>Each Cycle</h3>
<ol>
  <li>Claude proposes <strong>one specific change</strong> to test — e.g. "lead with a question instead of a statement" or "mention their city in line 1"</li>
  <li>That variant runs as a live campaign for 7 days</li>
  <li>After 7 days, ORACLE scores it against the baseline reply rate:</li>
</ol>
<ul>
  <li><strong>Winner</strong> — becomes the new baseline. All future campaigns start from here.</li>
  <li><strong>Loser</strong> — logged, never repeated. Baseline stays unchanged.</li>
  <li><strong>Inconclusive</strong> — not enough data. Noted for future reference.</li>
</ul>
<p>A new hypothesis is generated and the cycle repeats automatically.</p>

<h2>Fast-Fail: Early Abort</h2>
<p>ORACLE does not wait 7 days for clearly failing campaigns. Every 4 hours it checks each active experiment against three rules. The first rule triggered immediately pauses the campaign and frees the experiment slot:</p>
<table class="abort-table">
  <tr><th>Rule</th><th>Condition</th><th>Why it matters</th></tr>
  <tr><td>Deliverability failure</td><td>Open rate below 3% after 30+ sends</td><td>Emails are not reaching the inbox — domain or sending reputation issue</td></tr>
  <tr><td>High bounce rate</td><td>Bounce rate above 10% after 20+ sends</td><td>List quality or domain problem that will damage sender reputation</td></tr>
  <tr><td>Dead copy</td><td>Zero positive replies after 75+ sends with healthy open rate</td><td>Emails are being opened but the copy is not resonating at all</td></tr>
</table>
<p>When an early abort fires, you receive a Telegram alert with full stats, the campaign is paused in Instantly, and the next hypothesis is queued for the next loop cycle.</p>

<h2>Thompson Sampling (Multi-Armed Bandit)</h2>
<p>When multiple variant hypotheses exist, ORACLE does not test them round-robin. It uses <strong>Thompson Sampling</strong> — a statistical method that automatically allocates more test budget to variants showing early promise, while still exploring weaker candidates. Think of it as: give the leading horse more races, but keep the others in the field. This means the system learns faster and wastes fewer leads on long-shot ideas.</p>

<h2>Geo Targeting</h2>
<p>Campaigns rotate through 5 geo groups: <strong>UK, US East, US Central, US West, US Mountain</strong>.</p>
<ul>
  <li>For the <strong>UK</strong>, ORACLE scrapes city by city (London → Manchester → Birmingham → Leeds…) until the lead target is met</li>
  <li>For the <strong>US</strong>, it goes state by state within the region</li>
  <li>Each campaign gets the <strong>correct timezone automatically</strong> — London campaigns send during London business hours, New York campaigns during New York hours</li>
  <li>After each run, the geo group rotates to the next region</li>
  <li>You can override the active group manually from the Geo Targeting card in Controls</li>
</ul>

<h2>The Research Layer</h2>
<p>Eight background modules run quietly and feed intelligence into every new hypothesis. Here is what each one does:</p>

<div class="module-grid">
  <div class="module">
    <div class="module-name">Reply Classifier</div>
    <div class="module-freq">Every 4 hours</div>
    <p>Every inbound reply is categorised by AI: interested / question / objection / not interested / auto-reply / other. Builds a picture of what language is resonating and what is not.</p>
  </div>
  <div class="module">
    <div class="module-name">ICP Refiner</div>
    <div class="module-freq">Every 12 hours</div>
    <p>Groups all prospects by job title, country, and company size. Calculates reply rates per segment. Claude writes a refined ideal customer profile from the data.</p>
  </div>
  <div class="module">
    <div class="module-name">Step Attribution</div>
    <div class="module-freq">Every 8 hours</div>
    <p>Tracks which of the 4 emails in the sequence generates the most positive replies. If email 3 consistently wins, future sequences are adjusted accordingly.</p>
  </div>
  <div class="module">
    <div class="module-name">Cohort Analyser</div>
    <div class="module-freq">Every 12 hours</div>
    <p>Drills into the highest-performing prospect segments and distils a sharp ideal prospect description used in copy personalisation.</p>
  </div>
  <div class="module">
    <div class="module-name">Winner Synthesis</div>
    <div class="module-freq">Daily at 03:00 UTC</div>
    <p>After every 3 new winning experiments, Claude reads all winners and extracts meta-principles — patterns that explain why they worked — injected into every future hypothesis prompt.</p>
  </div>
  <div class="module">
    <div class="module-name">Program Evolution</div>
    <div class="module-freq">Mon / Wed / Fri</div>
    <p>Every 10 completed experiments, Claude rewrites program.md entirely based on proven and failed approaches. The outreach baseline evolves automatically.</p>
  </div>
  <div class="module">
    <div class="module-name">Deliverability Monitor</div>
    <div class="module-freq">Every 2 hours</div>
    <p>Checks open rate per campaign against the 7-day average. If a campaign drops more than 25%, you get a Telegram alert before bounces can accumulate and damage sender reputation.</p>
  </div>
  <div class="module">
    <div class="module-name">Vertical Researcher</div>
    <div class="module-freq">Weekly, Sunday</div>
    <p>After 15 experiments, Claude proposes adjacent industries to expand into. Proposals appear in the Verticals panel on the dashboard for your approval before any expansion begins.</p>
  </div>
</div>

<h2>Telegram Approvals</h2>
<p>ORACLE never sends a campaign without your approval. The flow is simple:</p>
<ol>
  <li>Campaign draft created → Telegram message with full details (geo region, lead count, inboxes, subject line preview)</li>
  <li>You reply <strong>approve</strong> or <strong>reject</strong></li>
  <li><strong>Approve</strong> → campaign launches in Instantly within seconds, leads uploaded, campaign activated, confirmation sent to you</li>
  <li><strong>Reject</strong> → draft discarded, experiment slot freed, next hypothesis queued for the next cycle</li>
  <li>Drafts auto-expire after 24 hours if you do not respond (configurable in Controls)</li>
</ol>

<h2>Dashboard Sections</h2>
<table>
  <tr><th>Section</th><th>What you see</th></tr>
  <tr><td><strong>Overview</strong></td><td>Live health metrics, recent activity feed, pipeline status summary</td></tr>
  <tr><td><strong>Pipeline</strong></td><td>Status of the current run: scraping / drafting / awaiting approval</td></tr>
  <tr><td><strong>Campaigns</strong></td><td>All live campaigns with real-time stats from Instantly</td></tr>
  <tr><td><strong>Experiments</strong></td><td>Full ledger of every hypothesis: pending / winner / loser / aborted / inconclusive</td></tr>
  <tr><td><strong>Research Intelligence</strong></td><td>Trajectory chart (every experiment as a dot, frontier line), ICP cohorts, reply breakdown, winner synthesis, deliverability alerts, verticals, Thompson sampling state</td></tr>
  <tr><td><strong>Replies</strong></td><td>All inbound replies with AI intent classification</td></tr>
  <tr><td><strong>Controls</strong></td><td>Campaign size limits, send schedule, timezone, skip-list, geo group selector</td></tr>
  <tr><td><strong>Sequence Preview</strong></td><td>The current 4-email sequence with subject lines and body copy</td></tr>
</table>

<h2>What You Need to Do Day-to-Day</h2>
<div class="callout">Almost nothing. The only regular action is <strong>approving campaigns on Telegram</strong> when ORACLE sends the request. Everything else — scraping, writing, testing, learning, evolving the playbook — runs automatically. Check the dashboard once a day to review the activity feed and research insights.</div>

<h3>Summary of Manual Touchpoints</h3>
<ul>
  <li><strong>Telegram approvals</strong> — one tap to approve each campaign before it launches</li>
  <li><strong>Vertical approvals</strong> — Claude proposes new industries, you confirm before expansion begins</li>
  <li><strong>Controls</strong> — adjust lead counts, send schedule, or geo group if needed</li>
  <li><strong>Skip list</strong> — add domains you never want to contact</li>
</ul>

<div class="footer">ORACLE System Guide &mdash; Confidential &mdash; March 2026</div>

</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'domcontentloaded' });
const pdf = await page.pdf({
  path: '/Users/ghost/Downloads/ORACLE_System_Guide.pdf',
  format: 'A4',
  margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
  printBackground: true
});
await browser.close();
console.log('PDF saved to /Users/ghost/Downloads/ORACLE_System_Guide.pdf');
