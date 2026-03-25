export const BASE_SEQUENCE = {
  variant_id: 'v5_cayman_outcome',
  vertical: 'real_estate',
  product: 'AIRO',
  version: 5,
  description: 'Outcome-led sequence. Opens with Cayman case study numbers. Leads with result not mechanism. Cold pipeline offer as risk reversal. VSL in email 3. Re-engagement at day 44. Spintax on key phrases for deliverability.',
  emails: [
    {
      step: 1,
      delay_days: 0,
      subject: '{{firstName}}',
      body: `{{firstName}},

We just finished a project for a land development firm in the Cayman Islands.

They had 30,000 leads sitting in their pipeline they were never going to contact. We ran our system across that list. Over 3,000 people picked up. 576 of those became qualified buyers. Average deal size at that firm can go up to $2.5 million.

{{RANDOM | The system works like this. | Here is how it works.}}

It {{RANDOM | calls every lead within 60 seconds of them enquiring | reaches every new inbound lead within 60 seconds of them raising their hand}}. It has a conversation with them, figures out if they are serious, and {{RANDOM | only passes the ones worth talking to across to the sales team | sends the serious buyers straight to your team}}. Your team never speaks to a time-waster.

I had a look at {{companyName}} and {{RANDOM | it looks like you are actively running inbound | from what I can see you are generating solid inbound volume | it looks like you have an active inbound pipeline}}. {{RANDOM | I think this system could work well for you. | I genuinely think this could be relevant for you. | Felt too relevant not to reach out.}}

We can run it on your cold leads first, the people in your pipeline that were never going to be contacted anyway. You see if it works, then you decide whether to run it on your live pipeline.

{{RANDOM | If any of this could be of use to {{companyName}}, I will send over the specifics. | Worth exploring for {{companyName}}? Just reply and I will walk you through it. | If this sounds relevant, just reply and I will send everything over.}}

{{sendingAccountFirstName}}`
    },
    {
      step: 2,
      delay_days: 3,
      subject: 'had to send these over',
      body: `{{firstName}},

{{RANDOM | Sent you a quick note a few days ago | Reached out recently}} about the Cayman project. {{RANDOM | Thought the easiest thing was just to show you what the system actually sounds like rather than describe it. | Figured showing you is easier than explaining it.}}

These are two real calls the system handled. No human on the line.

https://airo.velto.ai/audio/wire-transfer.mp3

https://airo.velto.ai/audio/not-ai.mp3

The first one is a buyer who was ready to make a wire transfer on that call. The second is worth listening to because it shows how the system handles someone who questions whether they are speaking to a real person.

Both calls came from a cold pipeline. These were not warm leads or recent enquiries. They were people who had gone quiet and were never going to be contacted again.

We have also {{RANDOM | run this for | done this with}} Idris Elba's creative operation and for Data Monsters, one of NVIDIA's elite partners. {{RANDOM | Different industries, same result, qualified conversations from leads the team had stopped chasing. | Same outcome across very different businesses, conversations from a pipeline the team had written off.}}

{{RANDOM | If it sounds like something worth exploring for {{companyName}}, just reply and I will walk you through exactly how a run would work for your pipeline. | If this feels relevant for {{companyName}}, just reply and I will show you exactly how it would work.}}

{{sendingAccountFirstName}}`
    },
    {
      step: 3,
      delay_days: 4,
      subject: 'the 391% stat',
      body: `{{firstName}},

Every 5 minutes that passes after someone enquires, the chance of converting them drops by around 400%.

That is not an opinion. {{RANDOM | That is what a decade of lead response research shows. | The research on this has been consistent for over ten years.}}

{{RANDOM | AIRO calls every enquiry within 60 seconds. | The system reaches every new lead within 60 seconds of them raising their hand.}} It qualifies them on that call. It passes the serious ones to your team and leaves the rest. Your people only ever pick up the phone for buyers worth talking to.

Everything is here if you want to see it in full: https://airo.velto.ai/

The recordings, the breakdown, and a way to book a call if it looks relevant for {{companyName}}.

{{sendingAccountFirstName}}`
    },
    {
      step: 4,
      delay_days: 6,
      subject: 'one thing before I go',
      body: `{{firstName}},

Every lead in {{companyName}}'s pipeline that went cold did not necessarily go cold because they were not interested. {{RANDOM | Some of them went cold because no one got back to them fast enough. | Some went quiet simply because the response window closed before anyone called.}} Those people are still in your database. They are not worth anything right now because no one is calling them. But they were real enquiries from people who raised their hand.

That is exactly the pool we started with in the land development company in the Caymans. 30,000 of them. 3,000 picked up.

{{RANDOM | If that is worth a conversation, you have my email. | If that is ever worth 20 minutes, just reply here.}}

{{sendingAccountFirstName}}`
    },
    {
      step: 5,
      delay_days: 30,
      subject: 'genuinely think this fits',
      body: `{{firstName}},

{{RANDOM | I want to be straight with you. | To be honest with you.}} The reason I keep coming back to your inbox is not to be persistent for the sake of it. It is because I genuinely think what we have built has real value for what {{companyName}} is doing.

You are already running inbound and {{RANDOM | from what I can see it is working | it looks like it is working well for you}}. {{RANDOM | That is the hard part. | Getting inbound working is the hard part.}}

The next step is making sure every serious lead that comes through actually gets spoken to before the window closes. {{RANDOM | That is exactly what AIRO does. | That is the gap AIRO closes.}} And I believe it would make a real difference here.

These are two real calls from our last run if you want to hear it in action.

https://airo.velto.ai/audio/wire-transfer.mp3

https://airo.velto.ai/audio/not-ai.mp3

https://airo.velto.ai/ has the full breakdown if now is a better time.

{{sendingAccountFirstName}}`
    }
  ]
};
