export const BASE_SEQUENCE = {
  variant_id: 'v1_baseline',
  vertical: 'real_estate',
  product: 'AIRO',
  version: 1,
  positive_reply_rate: null,
  emails: [
    {
      step: 1,
      delay_days: 0,
      subject: '{{firstName}}',
      body: `Hey {{firstName}},

Bit of an unusual one.

{{PERSONALISATION_HOOK}}

We have got a system that called back over 30,000 inbound enquiries within 60 seconds of someone raising their hand. No human in the loop. Qualifies them on the call. Only passes the serious ones to the team. One client ran it for 14 months and the system handled the equivalent of two and a half years of manual follow-up.

Would you be open to seeing what that looks like for {{companyName}}? If yes, I will send over the specifics.

Lubosi`
    },
    {
      step: 2,
      delay_days: 3,
      subject: 'had to send this over',
      body: `Hey {{firstName}},

Was looking at what {{companyName}} is doing with {{INBOUND_SOURCE}} and genuinely just had to reach back out.

Two live call recordings below. Real enquiries, handled by AIRO with no human on the line. Worth 90 seconds before you decide anything.

https://airo.velto.ai/audio/wire-transfer.mp3
https://airo.velto.ai/audio/not-ai.mp3

The reason I thought of you specifically: most property teams lose deals in the first five minutes after someone enquires. Not because the lead was bad. Because no one got there fast enough. The average team follows up in 4 to 8 hours. AIRO does it in under 60 seconds.

We built this for a land development firm in the Cayman Islands, for Idris Elba's creative operation, and for Data Monsters, an elite NVIDIA partner. Different industries, same gap.

Still a yes from you and I will send over exactly how this would work for {{companyName}}.

Lubosi`
    },
    {
      step: 3,
      delay_days: 4,
      subject: 'what 30,000 sales calls taught us',
      body: `Hey {{firstName}},

We have processed over 30,000 calls through AIRO. Not demos. Real inbound enquiries, across real pipelines, from people who raised their hand.

Here is what that volume teaches you.

The teams converting at the highest rate are not the ones with the best closers. They are the ones who got to the lead first. Reaching out within 60 seconds of an enquiry boosts conversion by 391% compared to following up after five minutes. That gap compounds fast.

Here is how it usually shows up for property teams: leads going cold in the database. High volume, low conversion. Sales team chasing no-shows instead of closing. Morale drops because they are spending energy on people who have already moved on.

Those are all symptoms of one thing. Speed to lead.

AIRO solves every single one of them. It calls the moment someone enquires, qualifies them on that call, and your team only picks up the phone when there is a real buyer on the other end.

Worth a quick conversation to see how this would work at {{companyName}}?

Lubosi`
    },
    {
      step: 4,
      delay_days: 6,
      subject: 'one thing before I close this',
      body: `Hey {{firstName}},

Last one from me on this, I promise.

If {{companyName}} ever has inbound coming in from ads, a landing page, portals, or anywhere else and the team is not getting to those enquiries fast enough, AIRO is probably worth 20 minutes of your time.

60 second callback. Autonomous qualification. Your team only picks up when there is a serious buyer. The property teams using it have stopped chasing leads entirely.

Just a yes or no is fine.

Lubosi`
    }
  ]
};
