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
  /* Knowledge base (mock policy documents)                              */
  /* ------------------------------------------------------------------ */
  const KB = [
    {
      id: 'kb_identity',
      title: 'Caller identity verification',
      text: 'Before any prescription, claim or health detail is discussed, verify the caller with two identifiers from the patient record (full name and date of birth) plus one contact identifier (the phone number on file or a prescription number). Then send a one-time passcode to the phone on file and have the caller read it back. If the caller is not the patient, they must be listed as an authorized representative on the record; otherwise offer to call the patient directly. Never confirm or deny that a prescription exists before verification is complete. Agents may say that they are verifying identity for privacy reasons.'
    },
    {
      id: 'kb_refill',
      title: 'Refill timing rules',
      text: 'Insurance plans reject a refill as "refill too soon" (rejection code 79) when too little of the current supply has been used. For non-controlled medications the plan pays once about 75 percent of the days\' supply is used; for controlled substances it is 90 percent. The eligible date is counted from the last fill date, so a 30-day fill picked up on the 21st of September becomes eligible on the 24th of October. Early refills for travel ("vacation supply") need a one-time override that the pharmacist requests from the plan; agents should not promise an override. Converting to a 90-day supply is processed as a new claim and is not blocked by the refill-too-soon window when the prescription has refills remaining.'
    },
    {
      id: 'kb_rejections',
      title: 'Insurance rejection codes',
      text: 'Code 70, product not covered: offer the covered alternative or a cash price. Code 75, prior authorization required: tell the caller the prescriber must submit the authorization; typical turnaround is 2 to 3 business days. Code 76, plan limit exceeded: the quantity or days\' supply is above the plan limit; offer the covered quantity. Code 79, refill too soon: a timing rejection, not a coverage problem; give the eligible date. Code 88, drug utilization review: a safety flag that must be reviewed by the pharmacist before the claim can be rerun. Always read the rejection reason back to the caller in plain words before rerunning a claim.'
    },
    {
      id: 'kb_savings',
      title: 'Cost and savings options',
      text: 'A 90-day supply usually carries a lower combined copay than three 30-day fills; quote both from the insurance check before offering. A 90-day conversion uses the remaining refills on the prescription, so no new prescription is needed while refills remain. Manufacturer coupons cannot be combined with federal plans such as Medicare Part D or Medicaid. A discount card can be used instead of insurance on a given fill, but the two cannot be stacked on the same fill. Generic substitution is automatic unless the prescriber marked "dispense as written". Agents may quote prices from the insurance check only, never from memory.'
    },
    {
      id: 'kb_immunization',
      title: 'Immunization services',
      text: 'Pharmacists give flu shots to patients aged 3 and up, by appointment or walk-in, during pharmacy hours. Most commercial plans and Medicare Part B cover the seasonal flu vaccine at no cost; confirm coverage from the vaccine eligibility check. A flu shot can be given at the same visit as a COVID-19 vaccine. Patients should bring an insurance card and photo ID. The immunization record is available in the app and sent to the state registry within 24 hours. Patients 65 and older are offered the high-dose formulation. Clinical questions about reactions or contraindications go to the pharmacist.'
    },
    {
      id: 'kb_transfer',
      title: 'Prescription transfers',
      text: 'Prescriptions move between Walgreens stores instantly; the receiving store can usually fill within 15 minutes of the request. Transfers from another pharmacy chain take 1 to 2 business days because the pharmacist must contact the other pharmacy. Controlled substances in Schedule II cannot be transferred and need a new prescription; Schedules III to V can be transferred once. To start a transfer, confirm the receiving store, the prescription number or medication name, and the current pharmacy\'s phone number.'
    },
    {
      id: 'kb_escalation',
      title: 'Escalation and sensitive topics',
      text: 'Agents do not give clinical advice. Questions about dosing, side effects, drug interactions, pregnancy or missed doses are warm-transferred to the pharmacist; tell the caller a pharmacist will join and expect a wait of up to 5 minutes. Billing disputes above 100 dollars, complaints about staff, and any request involving a deceased patient go to a supervisor. If a caller mentions self-harm, stay on the line and follow the crisis protocol. Treat mental health, HIV, substance use and reproductive health prescriptions as sensitive: confirm the caller is the patient before naming the medication.'
    }
  ];

  /* ------------------------------------------------------------------ */
  /* SOP workflow catalog                                                 */
  /* ------------------------------------------------------------------ */
  const SOP = [
    { id: 'verification', title: 'Verification', always: true, when: 'Every call, before any prescription detail is discussed.',
      steps: [
        { id: 'v1', label: 'Confirm name and date of birth' },
        { id: 'v2', label: 'Send one-time passcode (SMS)' },
        { id: 'v3', label: 'Verify passcode' }
      ] },
    { id: 'rx_issue', title: 'Prescription issue', when: 'The caller reports a refill, claim or prescription problem.',
      steps: [
        { id: 'p1', label: 'Locate prescription' },
        { id: 'p2', label: 'Check refill and claim status' },
        { id: 'p3', label: 'Read rejection reason back to caller' },
        { id: 'p4', label: 'Rerun claim or offer alternative' }
      ] },
    { id: 'cost', title: 'Cost and savings', when: 'The caller mentions price, copays or affordability.',
      steps: [
        { id: 'c1', label: 'Check 90-day supply eligibility' },
        { id: 'c2', label: 'Quote copay options' },
        { id: 'c3', label: "Confirm caller's choice" }
      ] },
    { id: 'immunization', title: 'Immunization', when: 'The caller asks about a vaccine or flu shot.',
      steps: [
        { id: 'i1', label: 'Check flu shot eligibility' },
        { id: 'i2', label: 'Find appointment slots' },
        { id: 'i3', label: 'Book appointment' }
      ] },
    { id: 'transfer', title: 'Prescription transfer', when: 'The caller wants a prescription moved to or from another pharmacy or store.',
      steps: [
        { id: 't1', label: 'Confirm receiving store' },
        { id: 't2', label: 'Submit transfer request' },
        { id: 't3', label: 'Give transfer timeline' }
      ] },
    { id: 'escalation', title: 'Escalation', when: 'The caller asks a clinical question or the issue needs a pharmacist or supervisor.',
      steps: [
        { id: 'e1', label: 'Tell caller a pharmacist will join' },
        { id: 'e2', label: 'Warm-transfer to pharmacist' }
      ] },
    { id: 'wrapup', title: 'Wrap-up', always: true, when: 'Every call, before hanging up.',
      steps: [
        { id: 'w1', label: 'Confirm pickup store and time' },
        { id: 'w2', label: 'Send confirmation (text or email)' },
        { id: 'w3', label: 'Log call summary' }
      ] }
  ];

  const TAGS = [
    'Identity verified', 'Consent given', 'Insurance rejection', 'Price-sensitive', 'Flu shot request',
    'Transfer request', 'Escalation needed', 'Sensitive topic', 'Policy risk', 'Controlled substance', 'Caller frustrated'
  ];

  const GUIDANCE_KINDS = ['say', 'ask', 'tell', 'info', 'do', 'recommendation', 'caution', 'answer'];

  /* ------------------------------------------------------------------ */
  /* Mock tools (the actions the agent can run from the screen)          */
  /* ------------------------------------------------------------------ */
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const firstRx = (user) => (user.prescriptions[0] || {}).rx || '';
  const describeRx = (p) => `${p.drug} (Rx ${p.rx}) · ${p.refills} refills left · last fill ${p.lastFill} · ${p.status}`;

  const lastCallerLine = (c) => { const l = [...c.transcript].reverse().find((x) => x.speaker === 'caller'); return l ? l.text : ''; };
  const money = (v) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;

  const TOOLS = [
    {
      id: 'verify_identity', label: 'Verify Identity',
      description: 'Match the caller\'s name, date of birth and phone against the patient record. Use before any prescription detail is discussed.',
      inputs: [
        { key: 'name', label: 'Patient name', prefill: (c) => c.user.name },
        { key: 'dob', label: 'Date of birth', prefill: (c) => c.user.dob },
        { key: 'phone', label: 'Phone on file', prefill: (c) => c.user.phone }
      ],
      run: (inp, c) => {
        const u = c.user;
        const nameOk = String(inp.name || '').trim().toLowerCase() === u.name.toLowerCase();
        const dobOk = digits(inp.dob) === digits(u.dob);
        const phoneOk = digits(inp.phone).slice(-4) === digits(u.phone).slice(-4);
        const match = nameOk && dobOk && phoneOk;
        return {
          output: {
            'Match': match ? 'Yes' : 'No',
            'Patient record': `${u.name} · DOB ${u.dob}`,
            'Identifiers checked': `Name ${nameOk ? 'ok' : 'mismatch'}, DOB ${dobOk ? 'ok' : 'mismatch'}, phone ${phoneOk ? 'ok' : 'mismatch'}`,
            'Next': match ? 'Send one-time passcode to the phone on file' : 'Ask the caller to repeat the details; do not discuss the prescription'
          },
          stepsDone: match ? ['v1'] : [],
          cards: match ? [] : [{ kind: 'caution', text: 'Details do not match the record. Ask the caller to repeat them; do not confirm that a prescription exists.', source: 'KB · Caller identity verification' }]
        };
      }
    },
    {
      id: 'send_otp', label: 'Send OTP',
      description: 'Send a six-digit one-time passcode by SMS to the phone number on file.',
      inputs: [{ key: 'phone', label: 'Phone number', prefill: (c) => c.user.phone }],
      run: (inp, c) => ({
        output: { 'Sent': 'Yes', 'To': c.user.phoneMasked, 'Code (demo mode)': '482 913', 'Expires': 'In 5 minutes' },
        stepsDone: ['v2'],
        cards: []
      })
    },
    {
      id: 'verify_otp', label: 'Verify OTP',
      description: 'Check the six-digit passcode the caller reads back.',
      inputs: [{ key: 'code', label: 'Passcode', prefill: (c) => {
        const recent = c.transcript.filter((l) => l.speaker === 'caller').slice(-3).map((l) => l.text).join(' ');
        const words = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
        const spoken = recent.toLowerCase().replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => words[w]);
        const m = digits(spoken.replace(/[\s,-]/g, '')).match(/\d{6}/);
        return m ? m[0] : '';
      } }],
      run: (inp) => {
        const ok = digits(inp.code) === '482913';
        return {
          output: { 'Verified': ok ? 'Yes' : 'No', 'Method': 'SMS one-time passcode', 'Note': ok ? 'Caller may now discuss prescriptions and claims' : 'Code does not match; resend or try once more' },
          stepsDone: ok ? ['v3'] : [],
          tagsAdd: ok ? ['Identity verified'] : [],
          cards: ok ? [] : [{ kind: 'caution', text: 'Passcode did not match. Resend the code once; if it fails again, offer a call back to the number on file.', source: 'KB · Caller identity verification' }]
        };
      }
    },
    {
      id: 'lookup_rx', label: 'Lookup Rx',
      description: 'List the patient\'s prescriptions with refill counts and status, or find one by number or drug name.',
      inputs: [
        { key: 'patient', label: 'Patient name', prefill: (c) => c.user.name },
        { key: 'query', label: 'Rx number or drug', prefill: (c) => firstRx(c.user) }
      ],
      run: (inp, c) => {
        const q = String(inp.query || '').toLowerCase();
        const list = c.user.prescriptions.filter((p) => !q || p.rx.includes(q) || p.drug.toLowerCase().includes(q));
        const shown = list.length ? list : c.user.prescriptions;
        const out = { 'Found': `${shown.length} prescription${shown.length === 1 ? '' : 's'}` };
        shown.forEach((p) => { out[`Rx ${p.rx}`] = describeRx(p); });
        return { output: out, stepsDone: ['p1'] };
      }
    },
    {
      id: 'check_insurance', label: 'Check Insurance',
      description: 'Check plan status, the latest claim result and rejection reason, days\' supply used, and 30-day versus 90-day copays for a prescription.',
      inputs: [
        { key: 'memberId', label: 'Member ID', prefill: (c) => c.user.insurance.memberId },
        { key: 'rx', label: 'Rx number', prefill: (c) => firstRx(c.user) }
      ],
      run: (inp, c) => {
        const u = c.user;
        if (u.id === 'maria' && digits(inp.rx) === '77312208') {
          return {
            output: {
              'Plan': `${u.insurance.plan} · ${u.insurance.status}`,
              'Claim 10/18': 'Rejected · code 79 (refill too soon)',
              "Days' supply used": '68% · eligible again 10/24',
              '30-day copay': u.insurance.copay30,
              '90-day copay': u.insurance.copay90,
              'Prior authorization': 'Not required'
            },
            stepsDone: ['p2', 'c1'],
            cards: [{ kind: 'info', text: 'Claim rejected with code 79, refill too soon. It is timing, not coverage.',
              bullets: ['68% of the supply used; the plan pays at 75%, eligible again Friday 10/24', 'Read the rejection reason back before rerunning anything', 'A 90-day fill runs as a new claim today: $12 copay versus $30 per 30 days'],
              source: 'Check Insurance · KB Refill timing rules' }]
          };
        }
        const three = money(u.insurance.copay30) * 3;
        const saves = three - money(u.insurance.copay90);
        return {
          output: {
            'Plan': `${u.insurance.plan} · ${u.insurance.status}`,
            'Latest claim': 'Approved',
            '30-day copay': u.insurance.copay30,
            '90-day copay': u.insurance.copay90,
            'Prior authorization': 'Not required'
          },
          stepsDone: ['p2', 'c1'],
          cards: saves > 0 ? [{ kind: 'recommendation', text: 'Offer the 90-day supply.',
            bullets: [`${u.insurance.copay90} per 90 days versus $${three.toFixed(2)} for three 30-day fills`, `Saves about $${saves.toFixed(0)} a quarter and means fewer pickups`],
            source: 'Check Insurance output' }] : []
        };
      }
    },
    {
      id: 'rerun_claim', label: 'Rerun Claim',
      description: 'Resubmit the insurance claim for a prescription, optionally as a 90-day supply.',
      inputs: [
        { key: 'rx', label: 'Rx number', prefill: (c) => firstRx(c.user) },
        { key: 'days', label: "Days' supply", type: 'select', options: ['30', '90'], prefill: (c) => {
          const recent = c.transcript.slice(-6).map((l) => l.text).join(' ');
          return /90/.test(recent) ? '90' : '30';
        } }
      ],
      run: (inp, c) => {
        const u = c.user;
        const ninety = String(inp.days) === '90';
        if (u.id === 'maria' && !ninety) {
          return {
            output: { 'Result': 'Rejected · code 79 (refill too soon)', 'Eligible date': '10/24/2026', 'Note': 'A 30-day refill will keep rejecting until 10/24. A 90-day supply runs as a new claim.' },
            cards: [{ kind: 'recommendation', text: 'The 30-day refill rejected again. Offer the 90-day supply instead; it runs as a new claim today.', source: 'KB · Refill timing rules' }]
          };
        }
        return {
          output: {
            'Result': 'Approved',
            'Copay': ninety ? u.insurance.copay90 : u.insurance.copay30,
            "Days' supply": ninety ? '90' : '30',
            'Ready for pickup': 'Today after 4:30 PM',
            'Store': `${u.store.name} (${u.store.id})`
          },
          stepsDone: ['p4'],
          cards: [{ kind: 'tell', text: `Approved: ${ninety ? u.insurance.copay90 : u.insurance.copay30} for ${ninety ? '90' : '30'} days, ready today after 4:30 PM at ${u.store.name}.`, source: 'Rerun Claim output' }]
        };
      }
    },
    {
      id: 'vaccine_slots', label: 'Vaccine Slots',
      description: 'Check vaccine eligibility and coverage for the patient and list open appointment slots at a store.',
      inputs: [
        { key: 'store', label: 'Store', prefill: (c) => `${c.user.store.name} (${c.user.store.id})` },
        { key: 'vaccine', label: 'Vaccine', type: 'select', options: ['Influenza (flu)', 'COVID-19', 'Shingles', 'Tdap'], prefill: () => 'Influenza (flu)' },
        { key: 'date', label: 'Date', prefill: () => 'Today' }
      ],
      run: (inp, c) => {
        const u = c.user;
        const last = u.immunizations.find((i) => /influenza/i.test(i.vaccine));
        return {
          output: {
            'Eligible': last ? `Yes · last flu shot ${last.date}` : 'Yes · no flu shot on file this season',
            'Coverage': `$0 copay (${u.insurance.plan.split(' ')[0]})`,
            'Open slots': `${inp.date || 'Today'}: 4:40 PM, 5:00 PM, 5:20 PM, 6:10 PM`,
            'Walk-in': 'Available, wait about 25 minutes'
          },
          stepsDone: ['i1', 'i2'],
          cards: [{ kind: 'recommendation', text: 'Offer 4:40 PM today: right after the prescription is ready, and the shot is covered at $0.', source: 'Vaccine Slots output' }]
        };
      }
    },
    {
      id: 'book_appointment', label: 'Book Appointment',
      description: 'Book a vaccine appointment slot for the patient at a store.',
      inputs: [
        { key: 'patient', label: 'Patient name', prefill: (c) => c.user.name },
        { key: 'store', label: 'Store', prefill: (c) => `${c.user.store.name} (${c.user.store.id})` },
        { key: 'vaccine', label: 'Vaccine', prefill: () => 'Influenza (flu)' },
        { key: 'slot', label: 'Slot', prefill: (c) => {
          const recent = c.transcript.filter((l) => l.speaker === 'caller').slice(-2).map((l) => l.text).join(' ');
          const m = recent.match(/\b\d{1,2}:\d{2}\b/);
          return m ? `${m[0]} PM` : '4:40 PM';
        } }
      ],
      run: (inp) => ({
        output: { 'Confirmation': 'FLU-88213', 'When': `Today ${inp.slot || '4:40 PM'}`, 'Where': inp.store || '', 'Bring': 'Insurance card and photo ID', 'Record': 'In the app and state registry within 24 hours' },
        stepsDone: ['i3'],
        cards: [{ kind: 'tell', text: `Booked for ${inp.slot || '4:40 PM'} today, confirmation FLU-88213.`, bullets: ['Bring insurance card and photo ID', 'The record shows in the app within 24 hours'], source: 'Book Appointment output' }]
      })
    },
    {
      id: 'send_confirmation', label: 'Send Confirmation',
      description: 'Send a confirmation by text message or email using the contact details on file.',
      inputs: [
        { key: 'channel', label: 'Channel', type: 'select', options: ['SMS', 'Email'], prefill: (c) => (/email/i.test(c.user.preferredContact) ? 'Email' : 'SMS') },
        { key: 'message', label: 'Message', prefill: (c) => `${c.user.store.name}: your prescription is ready for pickup today after 4:30 PM.` }
      ],
      run: (inp, c) => {
        const email = String(inp.channel) === 'Email';
        return {
          output: { 'Sent': 'Yes', 'Channel': email ? 'Email' : 'SMS', 'To': email ? c.user.email : c.user.phoneMasked, 'Message': inp.message || '' },
          stepsDone: ['w2'],
          cards: []
        };
      }
    },
    {
      id: 'transfer_rx', label: 'Transfer Rx',
      description: 'Move a prescription to another Walgreens store or request a transfer from another pharmacy.',
      inputs: [
        { key: 'rx', label: 'Rx number', prefill: (c) => firstRx(c.user) },
        { key: 'destination', label: 'Receiving store', prefill: () => 'Walgreens Davis St (#4488)' },
        { key: 'from', label: 'Current pharmacy', prefill: (c) => `${c.user.store.name} (${c.user.store.id})` }
      ],
      run: (inp) => {
        const internal = /walgreens/i.test(String(inp.from || '')) && /walgreens/i.test(String(inp.destination || ''));
        return {
          output: { 'Request': 'Submitted', 'Transfer ID': 'TR-55102', 'To': inp.destination || '', 'Ready': internal ? 'In about 15 minutes' : '1 to 2 business days (pharmacist contacts the other pharmacy)' },
          stepsDone: ['t2'],
          cards: [{ kind: 'tell', text: internal ? `Transfer TR-55102 is in; ready at ${inp.destination} in about 15 minutes.` : `Transfer request TR-55102 is in. From ${inp.from} it takes 1 to 2 business days; the pharmacist has to call them.`, source: 'KB · Prescription transfers' }]
        };
      }
    },
    {
      id: 'page_pharmacist', label: 'Page Pharmacist',
      description: 'Warm-transfer the call to the on-duty pharmacist for a clinical question. The agent stays on the line until the pharmacist joins.',
      inputs: [
        { key: 'patient', label: 'Patient name', prefill: (c) => c.user.name },
        { key: 'reason', label: 'Reason', prefill: (c) => lastCallerLine(c).slice(0, 90) }
      ],
      run: (inp) => ({
        output: { 'Status': 'Pharmacist paged', 'Pharmacist': 'R. Chen, PharmD', 'Joining in': 'About 2 minutes', 'Reason': inp.reason || '', 'Note': 'Stay on the line and introduce the caller and the question' },
        stepsDone: ['e2'],
        cards: []
      })
    },
    {
      id: 'log_summary', label: 'Log Summary',
      description: 'Write the call summary to the interaction record.',
      inputs: [{ key: 'summary', label: 'Summary', prefill: (c) => {
        const tools = (c.state && c.state.toolRuns ? c.state.toolRuns : []).map((r) => r.tool).filter((id) => id !== 'log_summary');
        const names = tools.map((id) => { const t = TOOLS.find((x) => x.id === id); return t ? t.label : id; });
        return `${c.user.name}: ${(c.state && c.state.tags && c.state.tags.length) ? c.state.tags.join(', ') : 'call handled'}. Actions: ${names.length ? names.join(', ') : 'none'}.`;
      } }],
      run: (inp) => ({
        output: { 'Logged': 'Yes', 'Interaction ID': 'INT-204411', 'Summary': inp.summary || '' },
        stepsDone: ['w3'],
        cards: []
      })
    }
  ];

  const DEFAULT_TOOLS = ['verify_identity', 'send_otp', 'lookup_rx', 'check_insurance', 'transfer_rx', 'send_confirmation'];

  /* ------------------------------------------------------------------ */
  /* Scripted call                                                        */
  /* ------------------------------------------------------------------ */
  /* Three scripted calls. Start call picks one at random. Every step turns green only
     when the agent performs it (a tool run) or says it, never when the caller merely
     supplies information. Guidance: at most one card per event, bullets inside. */
  const SCENARIOS = [
    {
      id: 'maria', userId: 'maria', title: 'Refill rejected by insurance, price-sensitive, flu shot add-on',
      turns: [
        { speaker: 'agent', text: 'Thank you for calling Walgreens Pharmacy on Main Street, this is Dana. How can I help you today?',
          delta: { tools: ['verify_identity', 'send_otp', 'lookup_rx', 'check_insurance'] } },
        { speaker: 'caller', text: 'Hi, this is Maria Lopez. I tried to refill my cholesterol medication in the app and it says the insurance rejected it. I really need it before the weekend.',
          delta: {
            activate: ['rx_issue'], tagsAdd: ['Insurance rejection'], suggestTool: 'verify_identity',
            guidance: [{ kind: 'caution', text: 'She named her prescription before verification. Confirm nothing about the claim until name, DOB and the phone on file are checked.', source: 'KB · Caller identity verification' }],
            bestReply: "I'm sorry about that, Maria, let's get it sorted before the weekend. First I need to verify a couple of details: can you confirm your date of birth and the phone number on the account?"
          } },
        { speaker: 'agent', text: "I'm sorry about that, Maria, let's get it sorted. Can you confirm your date of birth for me, and the phone number on the account?" },
        { speaker: 'caller', text: 'Sure. March 14th, 1981, and the phone number ends in 0142.',
          delta: { suggestTool: 'send_otp', tools: ['send_otp', 'verify_otp', 'lookup_rx', 'check_insurance'],
            bestReply: "Perfect, thank you. I'm sending a one-time passcode to the number ending in 0142 right now. Could you read it back to me when it arrives?" } },
        { speaker: 'agent', text: "Perfect. I'm sending a one-time passcode to that number now. Can you read it back to me when it arrives?",
          delta: { tool: [{ id: 'verify_identity', inputs: { name: 'Maria Lopez', dob: '03/14/1981', phone: '(312) 555-0142' } }, { id: 'send_otp', inputs: { phone: '(312) 555-0142' } }], suggestTool: 'verify_otp' } },
        { speaker: 'caller', text: "Got it. It's 4-8-2-9-1-3.",
          delta: { bestReply: "Thank you, that's verified. Let me pull up your atorvastatin now and see exactly what happened with the insurance claim." } },
        { speaker: 'agent', text: "Thanks, you're verified. Let me pull up your atorvastatin and see what happened with the claim.",
          delta: { tool: [{ id: 'verify_otp', inputs: { code: '482913' } }, { id: 'lookup_rx', inputs: { patient: 'Maria Lopez', query: '7731-2208' } }, { id: 'check_insurance', inputs: { memberId: 'XYZ-4471-8820', rx: '7731-2208' } }],
            tools: ['rerun_claim', 'check_insurance', 'lookup_rx', 'send_confirmation'] } },
        { speaker: 'agent', text: 'Okay, I can see the claim. Let me just rerun it for you.',
          delta: {
            steps: { p3: 'missed' },
            guidance: [{ kind: 'caution', text: 'Rejection reason not read back before rerunning.', bullets: ['She needs to hear it: code 79, refill too soon, 68% of the supply used, eligible again Friday 10/24', 'A 30-day rerun today rejects again'], source: 'KB · Insurance rejection codes' }]
          } },
        { speaker: 'caller', text: "Wait, why was it rejected? I haven't changed anything with my insurance.",
          delta: { bestReply: "Nothing has changed with your insurance, Maria. It's a 'refill too soon' rejection: the plan only pays once about three-quarters of your current supply is used, and you're at 68%. It will go through on Friday the 24th." } },
        { speaker: 'agent', text: "Nothing's changed with your plan. It's a 'refill too soon' rejection, insurance pays once about three-quarters of the supply is used, and you're a few days early. It'll go through on Friday the 24th.",
          delta: { steps: { p3: 'done' } } },
        { speaker: 'caller', text: "Friday's cutting it close, I leave Saturday morning. And honestly these copays are adding up, thirty dollars every single month.",
          delta: {
            activate: ['cost'], tagsAdd: ['Price-sensitive'], suggestTool: 'rerun_claim',
            guidance: [{ kind: 'recommendation', text: 'Offer the 90-day supply.', bullets: ['$12 copay instead of $30 a month', 'Runs as a new claim today, so it clears before she leaves Saturday', 'Uses the remaining refills; no new prescription needed'], source: 'Check Insurance · KB Cost and savings options' }],
            tools: ['rerun_claim', 'check_insurance', 'send_confirmation', 'lookup_rx'],
            bestReply: "I can help with both of those. Your plan covers a 90-day supply of atorvastatin for twelve dollars instead of thirty each month, and because it's a new 90-day claim I can run it today so it's ready before you leave. Would you like me to do that?"
          } },
        { speaker: 'agent', text: "I can actually help with both. Your plan covers a 90-day supply for twelve dollars instead of thirty a month, and since it's a new 90-day claim I can run it today so it's ready before you leave. Would you like that?",
          delta: { steps: { c2: 'done' } } },
        { speaker: 'caller', text: 'Yes, please. That would be great.',
          delta: { tagsAdd: ['Consent given'], bestReply: "Great, I'm converting it to a 90-day supply and running the claim now. Give me just a moment." } },
        { speaker: 'agent', text: 'Great, running that now as a 90-day supply.',
          delta: { steps: { c3: 'done' }, tool: { id: 'rerun_claim', inputs: { rx: '7731-2208', days: '90' } } } },
        { speaker: 'agent', text: "Done. The 90-day claim went through at twelve dollars, and it'll be ready for pickup today after 4:30 at the Main Street store.",
          delta: { tools: ['send_confirmation', 'vaccine_slots', 'lookup_rx', 'transfer_rx'] } },
        { speaker: 'caller', text: "Perfect, Main Street is fine. Oh, and while I have you, can I get a flu shot when I come in? My daughter's school needs the record.",
          delta: {
            steps: { w1: 'done' }, activate: ['immunization'], tagsAdd: ['Flu shot request'], suggestTool: 'vaccine_slots',
            guidance: [{ kind: 'info', text: 'The flu shot can be given at the same visit by the pharmacist.', bullets: ['BCBS PPO covers it at $0', "The record her daughter's school needs shows in the app and the state registry within 24 hours"], source: 'KB · Immunization services' }],
            tools: ['vaccine_slots', 'book_appointment', 'send_confirmation'],
            bestReply: "Absolutely, we can do the flu shot at the same visit. Let me check today's openings at Main Street so it lines up with your pickup."
          } },
        { speaker: 'agent', text: "Absolutely. Let me check today's openings at Main Street.",
          delta: { tool: { id: 'vaccine_slots', inputs: { store: 'Walgreens Main St (#4471)', vaccine: 'Influenza (flu)', date: 'Today' } } } },
        { speaker: 'agent', text: "You're eligible, and I have 4:40, 5:00 and 5:20 this afternoon, right after your prescription is ready. Which works?" },
        { speaker: 'caller', text: '4:40 works.',
          delta: { suggestTool: 'book_appointment', bestReply: "4:40 it is. I'm booking that now; you'll have a confirmation number in a second." } },
        { speaker: 'agent', text: '4:40 it is, booking that now.',
          delta: { tool: { id: 'book_appointment', inputs: { patient: 'Maria Lopez', store: 'Walgreens Main St (#4471)', vaccine: 'Influenza (flu)', slot: '4:40 PM' } } } },
        { speaker: 'agent', text: "You're booked for 4:40 today, confirmation FLU-88213. Bring your insurance card. I'll text both confirmations to the number ending 0142. Anything else I can help with?",
          delta: { tool: { id: 'send_confirmation', inputs: { channel: 'SMS', message: 'Walgreens Main St: atorvastatin 90-day supply ready today after 4:30 PM ($12.00). Flu shot booked 4:40 PM, confirmation FLU-88213. Bring your insurance card.' } } } },
        { speaker: 'caller', text: "No, that's everything. Thanks so much, Dana.",
          delta: { suggestTool: 'log_summary', bestReply: "You're very welcome, Maria. Your atorvastatin will be ready after 4:30 and the flu shot is at 4:40. Safe travels on Saturday, and thanks for calling Walgreens." } },
        { speaker: 'agent', text: "You're welcome, Maria. Safe travels on Saturday.",
          delta: { tool: { id: 'log_summary', inputs: { summary: 'Maria Lopez: refill-too-soon rejection (code 79) on atorvastatin resolved by 90-day conversion at $12, ready after 4:30 PM; flu shot booked 4:40 PM, FLU-88213; SMS confirmation sent.' } }, end: true } }
      ]
    },
    {
      id: 'james', userId: 'james', title: 'Transfer from CVS on Medicare, coupon question, wrong timeline given',
      turns: [
        { speaker: 'agent', text: 'Thank you for calling Walgreens Pharmacy on Lincoln Avenue, this is Dana. How can I help you today?',
          delta: { tools: ['verify_identity', 'send_otp', 'transfer_rx', 'lookup_rx'] } },
        { speaker: 'caller', text: 'Hi, this is James Carter. I called a couple of weeks ago about moving my blood thinner over from CVS, and I have the prescription number from them now. Can we do that today?',
          delta: {
            activate: ['transfer'], tagsAdd: ['Transfer request'], suggestTool: 'verify_identity',
            guidance: [{ kind: 'caution', text: 'Record note: hard of hearing. Speak slowly and read every number back twice.', source: 'Customer record' }],
            bestReply: 'Absolutely, James, we can start that today. First let me verify a couple of details: your date of birth, and the phone number we have on file for you?'
          } },
        { speaker: 'agent', text: 'Absolutely, James. Let me verify a couple of details first. Can you give me your date of birth and the phone number on the account?' },
        { speaker: 'caller', text: 'November 2nd, 1957. And the phone ends in 0188.',
          delta: { suggestTool: 'send_otp', tools: ['send_otp', 'verify_otp', 'transfer_rx', 'lookup_rx'],
            bestReply: "Thank you. I'm texting a one-time code to the number ending in 0188 now. Read it back to me slowly when it comes in." } },
        { speaker: 'agent', text: "Thanks. I'm texting a one-time code to that number now. Read it to me when it comes in.",
          delta: { tool: [{ id: 'verify_identity', inputs: { name: 'James Carter', dob: '11/02/1957', phone: '(773) 555-0188' } }, { id: 'send_otp', inputs: { phone: '(773) 555-0188' } }], suggestTool: 'verify_otp' } },
        { speaker: 'caller', text: 'Here it is. Four, eight, two, nine, one, three.' },
        { speaker: 'agent', text: "You're verified. So that's the apixaban, the Eliquis, coming over from CVS. Which store do you want it at, Lincoln Avenue?",
          delta: { tool: [{ id: 'verify_otp', inputs: { code: '482913' } }, { id: 'lookup_rx', inputs: { patient: 'James Carter', query: 'apixaban' } }], tools: ['transfer_rx', 'check_insurance', 'send_confirmation', 'lookup_rx'] } },
        { speaker: 'caller', text: 'Yes, Lincoln Avenue. The CVS prescription number is 3-3-1-7-8-8-0-2.',
          delta: { steps: { t1: 'done' }, suggestTool: 'transfer_rx',
            bestReply: "Got it, Lincoln Avenue. Let me read that back: three three one seven, eight eight zero two. I'm submitting the transfer request now." } },
        { speaker: 'agent', text: 'Got it. Let me read that back: three three one seven, eight eight zero two. Submitting the transfer now.',
          delta: { tool: { id: 'transfer_rx', inputs: { rx: 'CVS 3317-8802', destination: 'Walgreens Lincoln Ave (#2210)', from: 'CVS Pharmacy, 3100 N Lincoln Ave' } } } },
        { speaker: 'agent', text: "That's in. It should be ready for you in about fifteen minutes.",
          delta: {
            steps: { t3: 'missed' },
            guidance: [{ kind: 'caution', text: 'Wrong timeline given. Transfers from another chain take 1 to 2 business days; 15 minutes applies only between Walgreens stores. Correct it before he heads out.', source: 'KB · Prescription transfers' }]
          } },
        { speaker: 'caller', text: "Fifteen minutes? Wonderful, I'll walk over now.",
          delta: { bestReply: "Actually, James, I need to correct myself. Because it's coming from CVS, our pharmacist has to call them first, so it's one to two business days, not fifteen minutes. I'll make sure you're told the moment it's ready." } },
        { speaker: 'agent', text: "Actually, I need to correct myself. Because it's coming from CVS, our pharmacist has to call them, so it's one to two business days. I'll let you know the moment it's ready.",
          delta: { steps: { t3: 'done', w1: 'done' } } },
        { speaker: 'caller', text: "Oh. Alright then. While I have you, the Eliquis company sent me a coupon card. Can I use that with my Medicare plan? It's getting expensive.",
          delta: {
            activate: ['cost'], tagsAdd: ['Price-sensitive'], suggestTool: 'check_insurance',
            guidance: [{ kind: 'info', text: 'Manufacturer coupons cannot be combined with Medicare Part D. Do not apply it; check his plan for a 90-day option instead.', source: 'KB · Cost and savings options' }],
            tools: ['check_insurance', 'transfer_rx', 'send_confirmation', 'lookup_rx'],
            bestReply: "I'm sorry, James, that coupon can't be used together with a Medicare plan; that's a federal rule rather than a Walgreens one. But let me check what your plan does offer on the cost side."
          } },
        { speaker: 'agent', text: "Unfortunately that coupon can't be combined with a Medicare plan. But let me look at what your plan does offer.",
          delta: { tool: { id: 'check_insurance', inputs: { memberId: 'MED-2210-5531', rx: '5520-9044' } } } },
        { speaker: 'agent', text: "Your plan has a 90-day option at twenty dollars instead of ten dollars every month, so you'd save about ten dollars a quarter and make fewer trips. Want me to set the transfer up as a 90-day fill?",
          delta: { steps: { c2: 'done' } } },
        { speaker: 'caller', text: "Yes, let's do that.",
          delta: {
            tagsAdd: ['Consent given'],
            guidance: [{ kind: 'caution', text: 'Preferred contact on record is a phone call, not text. Ask before sending an SMS confirmation.', source: 'Customer record' }],
            bestReply: "Done, I've noted it as a 90-day fill. One more thing: your record says you prefer phone calls. When it's ready, should we call you, or would a text be alright?"
          } },
        { speaker: 'agent', text: "Done, it's noted as a 90-day fill. Your record says you prefer phone calls. When it's ready, should we call you, or is a text alright?",
          delta: { steps: { c3: 'done' } } },
        { speaker: 'caller', text: 'A text is fine. My daughter helps me with those.',
          delta: { suggestTool: 'send_confirmation', bestReply: "Perfect. I'll text the number ending in 0188 the moment it's ready. Is there anything else I can help with today?" } },
        { speaker: 'agent', text: "Perfect, I'll text the number ending 0188 the moment it's ready. Anything else today?",
          delta: { tool: { id: 'send_confirmation', inputs: { channel: 'SMS', message: 'Walgreens Lincoln Ave: your Eliquis transfer from CVS is in progress (TR-55102). We will text you when it is ready, usually within 1 to 2 business days.' } } } },
        { speaker: 'caller', text: "No, that's everything. Thank you for your patience.",
          delta: { suggestTool: 'log_summary', bestReply: "It was my pleasure, James. We'll text you as soon as it's ready. Take care." } },
        { speaker: 'agent', text: "You're welcome, James. Take care.",
          delta: { tool: { id: 'log_summary', inputs: { summary: 'James Carter: Eliquis (apixaban) transfer from CVS submitted, TR-55102, 1 to 2 business days; manufacturer coupon declined (Medicare Part D); set up as a 90-day fill at $20; SMS confirmation agreed.' } }, end: true } }
      ]
    },
    {
      id: 'priya', userId: 'priya', title: 'Inhaler moved to another store, clinical question escalated to the pharmacist',
      turns: [
        { speaker: 'agent', text: 'Thank you for calling Walgreens Pharmacy on Main Street, this is Dana. How can I help you today?',
          delta: { tools: ['verify_identity', 'send_otp', 'lookup_rx', 'transfer_rx'] } },
        { speaker: 'caller', text: "Hi, it's Priya Nair. I need my inhaler refilled, and could I pick it up at the Davis Street store instead? It's right by my office.",
          delta: { activate: ['transfer'], tagsAdd: ['Transfer request'], suggestTool: 'verify_identity',
            bestReply: 'Of course. Let me verify you first: can I get your date of birth and the phone number on the account?' } },
        { speaker: 'agent', text: 'Of course. Let me verify you first. Date of birth and the phone number on the account?' },
        { speaker: 'caller', text: 'July 30th, 1994, and the number ending in 0167.',
          delta: { suggestTool: 'send_otp', tools: ['send_otp', 'verify_otp', 'lookup_rx', 'transfer_rx'],
            bestReply: "Thanks, Priya. I'm sending a one-time code to the number ending in 0167 now; read it back to me when it arrives." } },
        { speaker: 'agent', text: 'Thanks. Sending a one-time code to that number now.',
          delta: { tool: [{ id: 'verify_identity', inputs: { name: 'Priya Nair', dob: '07/30/1994', phone: '(224) 555-0167' } }, { id: 'send_otp', inputs: { phone: '(224) 555-0167' } }], suggestTool: 'verify_otp' } },
        { speaker: 'caller', text: "It's 4-8-2-9-1-3." },
        { speaker: 'agent', text: "You're verified, and I see the albuterol inhaler with four refills left. Davis Street, right?",
          delta: { tool: [{ id: 'verify_otp', inputs: { code: '482913' } }, { id: 'lookup_rx', inputs: { patient: 'Priya Nair', query: 'albuterol' } }], tools: ['transfer_rx', 'send_confirmation', 'lookup_rx', 'check_insurance'] } },
        { speaker: 'caller', text: 'Yes, Davis Street please.',
          delta: { steps: { t1: 'done' }, suggestTool: 'transfer_rx', bestReply: "Davis Street it is. I'm moving the prescription over now; between our own stores it only takes about fifteen minutes." } },
        { speaker: 'agent', text: 'Davis Street it is, moving it over now.',
          delta: { tool: { id: 'transfer_rx', inputs: { rx: '8810-2217', destination: 'Walgreens Davis St (#4488)', from: 'Walgreens Main St (#4471)' } } } },
        { speaker: 'agent', text: "Done. It'll be ready at Davis Street in about fifteen minutes.",
          delta: { steps: { t3: 'done', w1: 'done' } } },
        { speaker: 'caller', text: "Perfect. Also, I've needed it a lot more this week, like five or six times a day. Is it okay to keep using it that much?",
          delta: {
            activate: ['escalation'], tagsAdd: ['Escalation needed'], suggestTool: 'page_pharmacist',
            guidance: [{ kind: 'caution', text: 'Clinical question: do not answer it.', bullets: ['Rescue inhaler use of 5 to 6 times a day is a safety flag the pharmacist must hear now', 'Tell her a pharmacist will join, then warm-transfer; expect up to 5 minutes'], source: 'KB · Escalation and sensitive topics' }],
            tools: ['page_pharmacist', 'send_confirmation', 'lookup_rx'],
            bestReply: "That's really a question for our pharmacist, and it's an important one, so I'm going to bring them onto the line right now. It may take a couple of minutes; please stay with me."
          } },
        { speaker: 'agent', text: "That's a question for our pharmacist, and it's an important one, so I'm going to bring them on the line. Give me a moment.",
          delta: { steps: { e1: 'done' }, tool: { id: 'page_pharmacist', inputs: { patient: 'Priya Nair', reason: 'Rescue inhaler use 5 to 6 times a day this week' } } } },
        { speaker: 'caller', text: 'Okay, thank you. Should I still pick up at Davis Street?',
          delta: {
            guidance: [{ kind: 'caution', text: 'Preferred contact on record is email, not text. Confirm before sending.', source: 'Customer record' }],
            bestReply: "Yes, Davis Street in about fifteen minutes. Your record says you prefer email; shall I email you when it's ready? And the pharmacist will be with you in just a moment."
          } },
        { speaker: 'agent', text: 'Yes, Davis Street in about fifteen minutes. Your record says you prefer email; should I email you when it\'s ready?' },
        { speaker: 'caller', text: 'Email is great.',
          delta: { suggestTool: 'send_confirmation', bestReply: "Done, you'll get an email as soon as it's ready. The pharmacist is joining now, so please stay on the line." } },
        { speaker: 'agent', text: 'Done. The pharmacist is joining now, so stay on the line.',
          delta: { tool: { id: 'send_confirmation', inputs: { channel: 'Email', message: 'Walgreens Davis St: your albuterol inhaler is being transferred from Main St and will be ready for pickup in about 15 minutes.' } } } },
        { speaker: 'caller', text: 'Thanks so much.',
          delta: { suggestTool: 'log_summary', bestReply: "You're welcome, Priya. Here's our pharmacist; they'll take it from here." } },
        { speaker: 'agent', text: "You're welcome, Priya. Here's the pharmacist.",
          delta: { tool: { id: 'log_summary', inputs: { summary: 'Priya Nair: albuterol Rx 8810-2217 moved to Davis St (#4488), ready in about 15 minutes; clinical question about rescue inhaler use 5 to 6 times a day escalated to pharmacist R. Chen; email confirmation sent.' } }, end: true } }
      ]
    }
  ];

  /* Canned answers for the ask box when no AI backend is connected. */
  const CANNED_ANSWERS = [
    { match: /coupon|discount card|goodrx|stack/i, answer: 'A discount card can be used instead of insurance on a fill, but not stacked with it on the same fill. Manufacturer coupons cannot be combined with Medicare Part D or Medicaid.', source: 'KB · Cost and savings options' },
    { match: /transfer/i, answer: 'Between Walgreens stores the transfer is instant and usually ready in about 15 minutes. From another chain it takes 1 to 2 business days. Schedule II drugs cannot be transferred.', source: 'KB · Prescription transfers' },
    { match: /vacation|early|override|too soon|code 79/i, answer: 'Refill-too-soon (code 79) clears once about 75% of the supply is used (90% for controlled substances). A travel override must be requested by the pharmacist; do not promise it. A 90-day conversion runs as a new claim.', source: 'KB · Refill timing rules' },
    { match: /flu|vaccine|shot|immuniz/i, answer: 'Pharmacists give flu shots to ages 3 and up, by appointment or walk-in. Most plans cover it at $0. Bring an insurance card and photo ID; the record is in the app within 24 hours.', source: 'KB · Immunization services' },
    { match: /side effect|interact|dose|dosing|pregnan|missed dose/i, answer: 'That is a clinical question. Tell the caller a pharmacist will join and warm-transfer; agents do not give clinical advice.', source: 'KB · Escalation and sensitive topics' },
    { match: /verify|identity|hipaa|authorized|representative/i, answer: 'Verify full name plus date of birth, then the phone on file or an Rx number, then the one-time passcode. A caller who is not the patient must be an authorized representative on file.', source: 'KB · Caller identity verification' },
    { match: /prior auth|code 75/i, answer: 'Code 75 means prior authorization is required. The prescriber submits it; typical turnaround is 2 to 3 business days.', source: 'KB · Insurance rejection codes' }
  ];

  global.DEMO = { USERS, KB, SOP, TAGS, GUIDANCE_KINDS, TOOLS, DEFAULT_TOOLS, SCENARIOS, CANNED_ANSWERS };
})(window);
