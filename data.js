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
        { rx: '7731-2208', drug: 'Atorvastatin 20 mg tablet', sig: '1 tablet daily', qty: 30, days: 30, refills: 2, lastFill: '09/26/2026', prescriber: 'Dr. Anita Rao', status: 'Refill requested; claim rejected 10/18 as refill too soon' },
        { rx: '7731-1194', drug: 'Metformin 500 mg tablet', sig: '1 tablet twice daily', qty: 60, days: 30, refills: 5, lastFill: '09/26/2026', prescriber: 'Dr. Anita Rao', status: 'Active' }
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
        { rx: '5520-9031', drug: 'Lisinopril 20 mg tablet', sig: '1 tablet daily', qty: 90, days: 90, refills: 1, lastFill: '08/14/2026', prescriber: 'Dr. Howard Lin', status: 'Active' }
      ],
      allergies: ['None on file'],
      immunizations: [
        { vaccine: 'Influenza (high dose)', date: '09/28/2026' },
        { vaccine: 'Shingles (dose 2 of 2)', date: '03/11/2026' }
      ],
      interactions: [
        { date: '10/05/2026', channel: 'Phone', summary: 'Asked how to move a CVS prescription to Walgreens; told to call back with the CVS Rx number.' }
      ],
      notes: 'Hard of hearing; speak slowly and confirm numbers twice. Daughter (Lauren Carter) is an authorized representative on file. Takes Eliquis (apixaban) filled at CVS, to be transferred to Walgreens.'
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
        { rx: '8810-2217', drug: 'Albuterol HFA inhaler 90 mcg', sig: '2 puffs every 4 to 6 hours as needed', qty: 1, days: 30, refills: 4, lastFill: '09/22/2026', prescriber: 'Dr. Samuel Osei', status: 'Active' }
      ],
      allergies: ['Sulfa drugs'],
      immunizations: [],
      interactions: [
        { date: '09/22/2026', channel: 'App chat', summary: 'New patient. Transferred albuterol from an out-of-state pharmacy.' }
      ],
      notes: 'New to Walgreens. Asked about switching pickup to the Davis St store closer to work.'
    }
  ];

  /* Scenarios for simulated calls live in scenarios/*.md and link to these records by id. */
  global.DEMO = { USERS };
})(window);
