<!-- Demo tools. Each "tool_name( ... ) -> output" block defines a mock tool the agent can call.
       desc:    (optional) what the tool does — helps the model decide when to call it
       input:   (optional) comma-separated argument names; a trailing ? marks an optional
                one ("store, date?"). Unknown inputs stay blank for the agent to fill in.
       message: (optional) human-readable heading for the tool's row ("Locating prescription")
       dynamic: (optional) true = an AI generates the result at call time so it fits
                the conversation; the output after -> becomes the format to imitate AND
                the fallback if generation fails. Set false to always return the output
                verbatim.
       auto_approved: true = a read-only lookup. false = it contacts the customer or
                commits something for them; in a simulated call the agent AI may ask
                for these. Every tool, either way, runs only when the human agent
                presses it after starting a workflow step. Omitted means false.
       output:  everything after "->" until the next block: the text returned to the
                model, written as pretty-printed multi-line JSON. Static when dynamic
                is off; the example format when dynamic is on.
     Every output starts with "headline" and "note": the screen shows them as the output card's title
     and footnote, with the other fields as labeled rows between them.
     String values are "quoted"; booleans are bare true/false.
     Example values in <angle brackets> are placeholders describing what goes there; the real
     values always come from the call, the customer record, the knowledge base and earlier results.
     Every tool here is used by a workflow step in system_prompt.md. -->

verify_representative(
    desc="Check that a caller who is not the patient is listed as an authorized representative on the patient's record, by the caller's full name and relationship",
    input="patient, representative, relationship",
    message="Verifying representative",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "patient": "<patient full name from the record>",
    "representative": "<representative full name from the record>",
    "relationship": "<relationship from the record>",
    "authorized": true,
    "scope": "<what the representative may handle, from the record>",
    "on_file_since": "<MM/DD/YYYY from the record>"
}

verify_identity(
    desc="Match the patient's full name, date of birth and phone number, as the caller states them, against the patient record. Another pharmacy's prescription number is not an identifier",
    input="name, dob, phone",
    message="Verifying identity",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "match": true,
    "patient": "<patient full name>",
    "date_of_birth": "<MM/DD/YYYY>",
    "identifiers_checked": "name, date of birth, phone"
}

send_otp(
    desc="Send a six-digit one-time passcode by SMS to the patient's phone number on file",
    input="phone",
    message="Sending passcode",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "sent": true,
    "to": "(***) ***-<last 4 digits of the phone on file>",
    "code_demo_only": "<new random six-digit code>",
    "expires_in": "5 minutes"
}

verify_otp(
    desc="Check the six-digit passcode the caller reads back",
    input="code",
    message="Checking passcode",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "verified": true,
    "method": "SMS one-time passcode"
}

lookup_rx(
    desc="Find the patient's Walgreens prescriptions by full name and date of birth, optionally narrowed to one prescription number or drug name, with refills left and status",
    input="name, dob, query?",
    message="Locating prescription",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "patient": "<patient full name>",
    "found": 1,
    "prescriptions": [
        {"rx": "<rx number from the record>", "drug": "<drug and strength from the record>", "days_supply": 30, "refills_left": 1, "last_fill": "<MM/DD/YYYY from the record>", "status": "<status from the record>"}
    ]
}

check_insurance(
    desc="Check a Walgreens prescription against the patient's plan: plan status, the latest claim result and rejection code, days' supply used, the date the next fill is covered, and the 30-day and 90-day copays",
    input="memberId, rx",
    message="Checking insurance",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "plan": "<plan name from the record>",
    "plan_status": "<plan status from the record>",
    "rx": "<rx number>",
    "latest_claim": "<latest claim result from the record, with the rejection code and reason if it was rejected, or No claim yet>",
    "days_supply_used": "<percent of the last fill's days' supply used as of today>",
    "covered_from": "<MM/DD/YYYY the next fill is covered under the refill timing policy, or Covered now>",
    "copay_30_day": "<this prescription's 30-day copay from the record>",
    "copay_90_day": "<this prescription's 90-day copay from the record>"
}

find_stores(
    desc="Find a Walgreens store by street, neighborhood or ZIP code, with its store number, address, phone and pharmacy hours",
    input="location",
    message="Finding store",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "location": "<street or ZIP code searched>",
    "stores": [
        {"store": "<Walgreens store name and number from the store directory>", "address": "<street address>", "phone": "<store phone>", "pharmacy_hours": "<pharmacy hours>"}
    ]
}

request_refill(
    desc="Submit a refill of a Walgreens prescription for pickup at a Walgreens store, as a 30-day or 90-day supply",
    input="rx, store, days?",
    message="Requesting refill",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "request": "Submitted",
    "rx": "<rx number>",
    "store": "<pickup store name and number>",
    "days_supply": "<30 or 90>",
    "copay": "<copay for that supply, from the record>",
    "estimated_ready": "<day and time it will be ready, under the refill timing policy>",
    "held_until": "<MM/DD/YYYY, 7 days after it is ready>"
}

rerun_claim(
    desc="Resubmit a rejected insurance claim for a Walgreens prescription once it is covered, as a 30-day or 90-day supply, for pickup at the patient's store",
    input="rx, days",
    message="Rerunning claim",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "result": "Paid",
    "rx": "<rx number>",
    "days_supply": "<30 or 90>",
    "copay": "<copay for that supply, from the record>",
    "ready_for_pickup": "<day and time it will be ready, under the refill timing policy>",
    "store": "<pickup store name and number from the record>"
}

check_savings_options(
    desc="Check manufacturer coupons, discount cards and plan options for a medication, and whether each can be used with the patient's plan",
    input="drug, rx?",
    message="Checking savings options",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "drug": "<drug and strength>",
    "manufacturer_coupon": "<whether a coupon can be used with this plan, and why, under the cost and savings policy>",
    "discount_card": "<whether a discount card is cheaper than the plan copay>",
    "copay_30_day": "<30-day copay from the record>",
    "copay_90_day": "<90-day copay from the record>",
    "best_option": "<the cheapest valid option, with its price and what it saves>"
}

find_pharmacy(
    desc="Look up another pharmacy chain's store (for example CVS) by name and location, with its phone and fax for a transfer",
    input="name, location",
    message="Finding pharmacy",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "pharmacy": "<pharmacy name from the store directory>",
    "address": "<street, city, state ZIP>",
    "phone": "<phone number>",
    "fax": "<fax number>",
    "pharmacy_hours": "<pharmacy hours>"
}

transfer_rx(
    desc="Request a prescription transfer from another pharmacy chain to a Walgreens store",
    input="drug, from_pharmacy, from_phone, destination, from_rx?",
    message="Submitting transfer",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "request": "Submitted",
    "transfer_id": "<new transfer id>",
    "drug": "<drug and strength>",
    "from": "<other pharmacy name>",
    "to": "<receiving Walgreens store name and number>",
    "expected_ready": "<MM/DD/YYYY, 1 to 2 business days from today under the transfer policy>",
    "notify": "<how the store will tell the patient it is ready>"
}

vaccine_slots(
    desc="Check whether the patient is due for a vaccine and covered, and list open appointment slots at a store",
    input="store, vaccine, date?",
    message="Finding vaccine slots",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "vaccine": "<vaccine>",
    "due": true,
    "last_dose": "<MM/DD/YYYY from the record, or None on file>",
    "coverage": "<what the plan covers>",
    "store": "<store name and number>",
    "open_slots": ["<day and time>", "<day and time>", "<day and time>"]
}

book_appointment(
    desc="Book a vaccine appointment slot for the patient at a store",
    input="patient, store, vaccine, slot",
    message="Booking appointment",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "confirmation": "<confirmation number>",
    "when": "<day and time booked>",
    "where": "<store name and number>",
    "bring": "<what to bring, under the immunization policy>"
}

get_disclosure(
    desc="Get the approved word-for-word script for a required disclosure, such as consent for prescription text alerts",
    input="topic",
    message="Getting disclosure",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "topic": "<disclosure topic>",
    "disclosure_text": "<the approved script from the knowledge base, word for word, with the patient's details filled in>",
    "requires_consent": true
}

enroll_text_alerts(
    desc="Enroll the patient in prescription text alerts, after the approved disclosure was read and the caller said yes",
    input="phone, consent",
    message="Enrolling in text alerts",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "enrolled": true,
    "to": "(***) ***-<last 4 digits>",
    "alerts": "Ready for pickup, refill due, order delayed",
    "consent_recorded": "<when consent was given, today>",
    "opt_out": "Reply STOP to any alert"
}

update_patient_preferences(
    desc="Update the patient's contact channel for notifications, or the days' supply to fill a medication with from now on",
    input="patient, contact_channel?, fill_days?, medication?",
    message="Updating preferences",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "patient": "<patient full name>",
    "contact_channel": "<new contact channel, or unchanged>",
    "fill_days": "<30 or 90, or unchanged>",
    "medication": "<medication the fill length applies to, or none>",
    "updated": true
}

page_pharmacist(
    desc="Warm-transfer the call to the on-duty pharmacist for a clinical question or worsening symptoms, while the agent stays on the line",
    input="patient, reason",
    message="Paging pharmacist",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "status": "Pharmacist paged",
    "pharmacist": "<on-duty pharmacist name>, PharmD",
    "joining_in": "<a few minutes, up to 5 under the escalation policy>",
    "reason": "<the clinical question, in a few words>"
}

send_confirmation(
    desc="Send a confirmation of what was done on the call by text message or email, using the contact details on file",
    input="channel, message",
    message="Sending confirmation",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "sent": true,
    "channel": "<SMS or Email>",
    "to": "<masked phone or email on file>",
    "message": "<the confirmation text that was sent>"
}

log_summary(
    desc="Write the call summary to the interaction record",
    input="summary",
    message="Logging call",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "headline": "<the result in 3 to 6 plain words>",
    "note": "<one plain sentence on what this result means, from this result only>",
    "logged": true,
    "interaction_id": "<new interaction id>",
    "summary": "<one-line summary of what was resolved on this call>"
}
