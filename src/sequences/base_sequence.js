export const BASE_SEQUENCE = {
  variant_id: 'v2_refined',
  vertical: 'real_estate',
  product: 'AIRO',
  version: 2,
  positive_reply_rate: null,
  emails: [
    {
      step: 1,
      delay_days: 0,
      subject: '{{firstName}}',
      body: `{{personalization}}

Most inbound leads go cold before anyone picks up the phone. So we built something that calls every enquiry back within 60 seconds, qualifies them on the call, and only passes serious buyers to your team. It also works the other way, reviving the dead leads already sitting in your CRM that no one has followed up on.

One client got 2.5 years of follow-up work done in 14 months with a single agent.

Want me to send over the specifics?

{{sendingAccountFirstName}}`
    },
    {
      step: 2,
      delay_days: 3,
      subject: 'two calls',
      body: `{{firstName}},

Two calls AIRO handled. Worth 90 seconds.

The first is a buyer ready to make a wire transfer on the call. The second is a prospect who pushed back thinking they were speaking to AI.

Both are real. No script.

Recording 1: https://airo.velto.ai/audio/wire-transfer.mp3
Recording 2: https://airo.velto.ai/audio/not-ai.mp3

If this is something worth exploring for {{companyName}}, just reply and I will send over the specifics.

{{sendingAccountFirstName}}`
    },
    {
      step: 3,
      delay_days: 4,
      subject: 'the 391% stat',
      body: `{{firstName}},

Reaching out within 60 seconds of an enquiry boosts conversion by 391% compared to following up after five minutes.

Most teams follow up in hours. Some in days. By then the lead has moved on, replied to a competitor, or simply gone cold.

The teams converting at the highest rate are not the ones with the best closers. They are the ones who got there first.

AIRO does exactly that. It calls every enquiry within 60 seconds, qualifies them on the call, and only passes serious buyers to your team.

Worth exploring what that looks like for {{companyName}}?

{{sendingAccountFirstName}}`
    },
    {
      step: 4,
      delay_days: 6,
      subject: 'our clients',
      body: `{{firstName}},

We ran AIRO for a land development firm in the Cayman Islands, Idris Elba's creative operation, and Data Monsters, an elite NVIDIA partner.

Three completely different businesses. All had the same problem. Strong inbound, leads going cold before anyone got to them. AIRO called every enquiry within 60 seconds, qualified them on the call, and cut out the dead follow-up entirely.

If that sounds familiar at {{companyName}}, just reply yes and I will send over the specifics.

{{sendingAccountFirstName}}`
    }
  ]
};
