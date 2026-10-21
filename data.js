/* Phone Assist demo: scenario data for a Walgreens pharmacy support desk.
   Everything here is invented demo content. It is not Walgreens policy. */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Mock customers (Customer 360 records)                               */
  /* ------------------------------------------------------------------ */
  const USERS = [
    {
      id: 'maria',
      name: 'Maria Lopez',
      dob: '03/14/1981',
      phone: '(312) 555-0142',
      phoneMasked: '(***) ***-0142',
      email: 'maria.lopez@example.com',
      language: 'English',
      preferredContact: 'Text message',
      store: { id: '#4471', name: 'Walgreens Main St', address: '1601 Main St, Evanston, IL 60201', phone: '(847) 555-0199', hours: '8 AM to 10 PM' },
      insurance: { plan: 'BlueCross BlueShield PPO', memberId: 'XYZ-4471-8820', group: 'GRP-10422', status: 'Active', copay30: '$30.00', copay90: '$12.00' },
      prescriptions: [
        { rx: '7731-2208', drug: 'Atorvastatin 20 mg tablet', sig: '1 tablet daily', qty: 30, days: 30, refills: 2, lastFill: '09/21/2026', prescriber: 'Dr. Anita Rao', status: 'Refill requested; claim rejected 10/18' },
        { rx: '7731-1194', drug: 'Metformin 500 mg tablet', sig: '1 tablet twice daily', qty: 60, days: 30, refills: 5, lastFill: '10/02/2026', prescriber: 'Dr. Anita Rao', status: 'Active' }
      ],
      allergies: ['Penicillin'],
      immunizations: [
        { vaccine: 'Influenza', date: '10/09/2025' },
        { vaccine: 'COVID-19 (2025-26 formula)', date: '10/09/2025' }
      ],
      interactions: [
        { date: '09/21/2026', channel: 'App chat', summary: 'Set up refill reminders for atorvastatin and metformin.' },
        { date: '06/03/2026', channel: 'Phone', summary: 'Asked about generic substitution; switched to generic atorvastatin.' }
      ],
      notes: 'Prefers text confirmations. Travels for work and has asked about vacation supplies before.'
    },
    {
      id: 'james',
      name: 'James Carter',
      dob: '11/02/1957',
      phone: '(773) 555-0188',
      phoneMasked: '(***) ***-0188',
      email: 'jcarter57@example.com',
      language: 'English',
      preferredContact: 'Phone call',
      store: { id: '#2210', name: 'Walgreens Lincoln Ave', address: '2834 N Lincoln Ave, Chicago, IL 60657', phone: '(773) 555-0120', hours: '7 AM to 11 PM' },
      insurance: { plan: 'Medicare Part D (SilverScript Choice)', memberId: 'MED-2210-5531', group: 'PDP-7781', status: 'Active', copay30: '$10.00', copay90: '$20.00' },
      prescriptions: [
        { rx: '5520-9031', drug: 'Lisinopril 20 mg tablet', sig: '1 tablet daily', qty: 90, days: 90, refills: 1, lastFill: '08/14/2026', prescriber: 'Dr. Howard Lin', status: 'Active' },
        { rx: '5520-9044', drug: 'Apixaban 5 mg tablet', sig: '1 tablet twice daily', qty: 60, days: 30, refills: 3, lastFill: '10/05/2026', prescriber: 'Dr. Howard Lin', status: 'Active' }
      ],
      allergies: ['None on file'],
      immunizations: [
        { vaccine: 'Influenza (high dose)', date: '09/28/2026' },
        { vaccine: 'Shingles (dose 2 of 2)', date: '03/11/2026' }
      ],
      interactions: [
        { date: '10/05/2026', channel: 'Phone', summary: 'Asked how to move a CVS prescription to Walgreens; told to call back with the CVS Rx number.' }
      ],
      notes: 'Hard of hearing; speak slowly and confirm numbers twice. Daughter (Lauren Carter) is an authorized representative on file.'
    },
    {
      id: 'priya',
      name: 'Priya Nair',
      dob: '07/30/1994',
      phone: '(224) 555-0167',
      phoneMasked: '(***) ***-0167',
      email: 'priya.nair@example.com',
      language: 'English',
      preferredContact: 'Email',
      store: { id: '#4471', name: 'Walgreens Main St', address: '1601 Main St, Evanston, IL 60201', phone: '(847) 555-0199', hours: '8 AM to 10 PM' },
      insurance: { plan: 'Aetna Choice POS II', memberId: 'AET-9913-0042', group: 'GRP-55910', status: 'Active', copay30: '$15.00', copay90: '$30.00' },
      prescriptions: [
        { rx: '8810-2217', drug: 'Albuterol HFA inhaler 90 mcg', sig: '2 puffs every 4 to 6 hours as needed', qty: 1, days: 30, refills: 4, lastFill: '09/30/2026', prescriber: 'Dr. Samuel Osei', status: 'Active' }
      ],
      allergies: ['Sulfa drugs'],
      immunizations: [],
      interactions: [
        { date: '09/30/2026', channel: 'App chat', summary: 'New patient. Transferred albuterol from an out-of-state pharmacy.' }
      ],
      notes: 'New to Walgreens. Asked about switching pickup to the Davis St store closer to work.'
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Scripted calls                                                       */
  /* ------------------------------------------------------------------ */
  /* Only the spoken lines. Workflow steps, guidance and tool calls come from the
     prompt files; in scripted playback the suggested tool runs automatically. */
  const SCENARIOS = [
    {
      id: "maria", userId: "maria", title: "Refill rejected by insurance, price-sensitive, flu shot add-on",
      turns: [
        { speaker: "agent", text: "Thank you for calling Walgreens Pharmacy on Main Street, this is Dana. How can I help you today?" },
        { speaker: "caller", text: "Hi, this is Maria Lopez. I tried to refill my cholesterol medication in the app and it says the insurance rejected it. I really need it before the weekend." },
        { speaker: "agent", text: "I'm sorry about that, Maria, let's get it sorted. Can you confirm your date of birth for me, and the phone number on the account?" },
        { speaker: "caller", text: "Sure. March 14th, 1981, and the phone number ends in 0142." },
        { speaker: "agent", text: "Perfect. I'm sending a one-time passcode to that number now. Can you read it back to me when it arrives?" },
        { speaker: "caller", text: "Got it. It's 4-8-2-9-1-3." },
        { speaker: "agent", text: "Thanks, you're verified. Let me pull up your atorvastatin and see what happened with the claim." },
        { speaker: "agent", text: "Okay, I can see the claim. Let me just rerun it for you." },
        { speaker: "caller", text: "Wait, why was it rejected? I haven't changed anything with my insurance." },
        { speaker: "agent", text: "Nothing's changed with your plan. It's a 'refill too soon' rejection, insurance pays once about three-quarters of the supply is used, and you're a few days early. It'll go through on Friday the 24th." },
        { speaker: "caller", text: "Friday's cutting it close, I leave Saturday morning. And honestly these copays are adding up, thirty dollars every single month." },
        { speaker: "agent", text: "I can actually help with both. Your plan covers a 90-day supply for twelve dollars instead of thirty a month, and since it's a new 90-day claim I can run it today so it's ready before you leave. Would you like that?" },
        { speaker: "caller", text: "Yes, please. That would be great." },
        { speaker: "agent", text: "Great, running that now as a 90-day supply." },
        { speaker: "agent", text: "Done. The 90-day claim went through at twelve dollars, and it'll be ready for pickup today after 4:30 at the Main Street store." },
        { speaker: "caller", text: "Perfect, Main Street is fine. Oh, and while I have you, can I get a flu shot when I come in? My daughter's school needs the record." },
        { speaker: "agent", text: "Absolutely. Let me check today's openings at Main Street." },
        { speaker: "agent", text: "You're eligible, and I have 4:40, 5:00 and 5:20 this afternoon, right after your prescription is ready. Which works?" },
        { speaker: "caller", text: "4:40 works." },
        { speaker: "agent", text: "4:40 it is, booking that now." },
        { speaker: "agent", text: "You're booked for 4:40 today, confirmation FLU-88213. Bring your insurance card. I'll text both confirmations to the number ending 0142. Anything else I can help with?" },
        { speaker: "caller", text: "No, that's everything. Thanks so much, Dana." },
        { speaker: "agent", text: "You're welcome, Maria. Safe travels on Saturday." }
      ]
    },
    {
      id: "james", userId: "james", title: "Transfer from CVS on Medicare, coupon question, wrong timeline given",
      turns: [
        { speaker: "agent", text: "Thank you for calling Walgreens Pharmacy on Lincoln Avenue, this is Dana. How can I help you today?" },
        { speaker: "caller", text: "Hi, this is James Carter. I called a couple of weeks ago about moving my blood thinner over from CVS, and I have the prescription number from them now. Can we do that today?" },
        { speaker: "agent", text: "Absolutely, James. Let me verify a couple of details first. Can you give me your date of birth and the phone number on the account?" },
        { speaker: "caller", text: "November 2nd, 1957. And the phone ends in 0188." },
        { speaker: "agent", text: "Thanks. I'm texting a one-time code to that number now. Read it to me when it comes in." },
        { speaker: "caller", text: "Here it is. Four, eight, two, nine, one, three." },
        { speaker: "agent", text: "You're verified. So that's the apixaban, the Eliquis, coming over from CVS. Which store do you want it at, Lincoln Avenue?" },
        { speaker: "caller", text: "Yes, Lincoln Avenue. The CVS prescription number is 3-3-1-7-8-8-0-2." },
        { speaker: "agent", text: "Got it. Let me read that back: three three one seven, eight eight zero two. Submitting the transfer now." },
        { speaker: "agent", text: "That's in. It should be ready for you in about fifteen minutes." },
        { speaker: "caller", text: "Fifteen minutes? Wonderful, I'll walk over now." },
        { speaker: "agent", text: "Actually, I need to correct myself. Because it's coming from CVS, our pharmacist has to call them, so it's one to two business days. I'll let you know the moment it's ready." },
        { speaker: "caller", text: "Oh. Alright then. While I have you, the Eliquis company sent me a coupon card. Can I use that with my Medicare plan? It's getting expensive." },
        { speaker: "agent", text: "Unfortunately that coupon can't be combined with a Medicare plan. But let me look at what your plan does offer." },
        { speaker: "agent", text: "Your plan has a 90-day option at twenty dollars instead of ten dollars every month, so you'd save about ten dollars a quarter and make fewer trips. Want me to set the transfer up as a 90-day fill?" },
        { speaker: "caller", text: "Yes, let's do that." },
        { speaker: "agent", text: "Done, it's noted as a 90-day fill. Your record says you prefer phone calls. When it's ready, should we call you, or is a text alright?" },
        { speaker: "caller", text: "A text is fine. My daughter helps me with those." },
        { speaker: "agent", text: "Perfect, I'll text the number ending 0188 the moment it's ready. Anything else today?" },
        { speaker: "caller", text: "No, that's everything. Thank you for your patience." },
        { speaker: "agent", text: "You're welcome, James. Take care." }
      ]
    },
    {
      id: "priya", userId: "priya", title: "Inhaler moved to another store, clinical question escalated to the pharmacist",
      turns: [
        { speaker: "agent", text: "Thank you for calling Walgreens Pharmacy on Main Street, this is Dana. How can I help you today?" },
        { speaker: "caller", text: "Hi, it's Priya Nair. I need my inhaler refilled, and could I pick it up at the Davis Street store instead? It's right by my office." },
        { speaker: "agent", text: "Of course. Let me verify you first. Date of birth and the phone number on the account?" },
        { speaker: "caller", text: "July 30th, 1994, and the number ending in 0167." },
        { speaker: "agent", text: "Thanks. Sending a one-time code to that number now." },
        { speaker: "caller", text: "It's 4-8-2-9-1-3." },
        { speaker: "agent", text: "You're verified, and I see the albuterol inhaler with four refills left. Davis Street, right?" },
        { speaker: "caller", text: "Yes, Davis Street please." },
        { speaker: "agent", text: "Davis Street it is, moving it over now." },
        { speaker: "agent", text: "Done. It'll be ready at Davis Street in about fifteen minutes." },
        { speaker: "caller", text: "Perfect. Also, I've needed it a lot more this week, like five or six times a day. Is it okay to keep using it that much?" },
        { speaker: "agent", text: "That's a question for our pharmacist, and it's an important one, so I'm going to bring them on the line. Give me a moment." },
        { speaker: "caller", text: "Okay, thank you. Should I still pick up at Davis Street?" },
        { speaker: "agent", text: "Yes, Davis Street in about fifteen minutes. Your record says you prefer email; should I email you when it's ready?" },
        { speaker: "caller", text: "Email is great." },
        { speaker: "agent", text: "Done. The pharmacist is joining now, so stay on the line." },
        { speaker: "caller", text: "Thanks so much." },
        { speaker: "agent", text: "You're welcome, Priya. Here's the pharmacist." }
      ]
    }
  ];

  global.DEMO = { USERS, SCENARIOS };
})(window);
