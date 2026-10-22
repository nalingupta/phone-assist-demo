<!-- Demo tools. Each "tool_name( ... ) -> output" block defines a mock tool the agent can call.
       desc:    (optional) what the tool does — helps the model decide when to call it
       input:   (optional) comma-separated argument names; a trailing ? marks an optional
                one ("store, date?"). A required input that is unknown makes the AI
                pause and ask the agent to fill it in.
       message: (optional) status text shown while the tool runs ("Checking insurance")
       dynamic: (optional) true = an AI generates the result at call time so it fits
                the conversation; the output after -> becomes the format to imitate AND
                the fallback if generation fails. Set false to always return the output
                verbatim.
       auto_approved: true = the AI may run the tool on its own. false = only the human
                agent can run it (Execute); the AI may only suggest it. Use false for
                anything that contacts the customer or commits something for them.
                Omitted means false.
       output:  everything after "->" until the next block: the text returned to the
                model, written as pretty-printed multi-line JSON. Static when dynamic
                is off; the example format when dynamic is on.
     String values are "quoted"; booleans are bare true/false.
     Example values in <angle brackets> are placeholders describing what goes there; the real
     values always come from the call, the customer record and earlier results. -->

verify_identity(
    desc="Match the caller's name, date of birth and the phone number on file against the patient record before any prescription detail is discussed. Another pharmacy's prescription number is not an identifier",
    input="name, dob, phone",
    message="Verifying the caller",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "match": true,
    "patient": "<patient full name>",
    "date_of_birth": "<MM/DD/YYYY>",
    "identifiers_checked": "name, date of birth, phone",
    "next_step": "Send a one-time passcode to the phone on file"
}

send_otp(
    desc="Send a six-digit one-time passcode by SMS to the phone number on file",
    input="phone",
    message="Sending the passcode",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "sent": true,
    "to": "(***) ***-<last 4 digits of the phone on file>",
    "code_demo_only": "<new random six-digit code>",
    "expires_in": "5 minutes"
}

verify_otp(
    desc="Check the six-digit passcode the caller reads back",
    input="code",
    message="Checking the passcode",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "verified": true,
    "method": "SMS one-time passcode",
    "note": "Caller may now discuss prescriptions and claims"
}

lookup_rx(
    desc="List the patient's prescriptions with refill counts and status, or find one by number or drug name",
    input="patient, query?",
    message="Looking up prescriptions",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "found": 1,
    "prescriptions": [
        {"rx": "<rx number from the record>", "drug": "<drug and strength from the record>", "refills_left": 1, "last_fill": "<MM/DD/YYYY from the record>", "status": "<status from the record>"}
    ]
}

check_insurance(
    desc="Check plan status, the latest claim result and rejection reason, days' supply used, and 30-day versus 90-day copays for a prescription",
    input="memberId, rx",
    message="Checking insurance",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "plan": "<plan name from the record>",
    "plan_status": "<plan status from the record>",
    "latest_claim": "<latest claim result for this prescription, with the reason if it was rejected>",
    "days_supply_used": "<percent of the last fill's days' supply used as of today>",
    "eligible_date": "<MM/DD/YYYY the next fill is covered, or Eligible now>",
    "copay_30_day": "<30-day copay from the record>",
    "copay_90_day": "<90-day copay from the record>",
    "prior_authorization": "<Required or Not required>"
}

get_rx_status(
    desc="Get a prescription's fill status and the estimated ready time at the store filling it",
    input="rx, store?",
    message="Checking the prescription status",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "rx": "<rx number>",
    "status": "<fill status>",
    "estimated_ready_time": "<day and time it will be ready, or why it is not scheduled>",
    "store": "<store name and number>"
}

check_prescriber_authorization(
    desc="Check the days' supply the prescriber has authorized and whether a request to the prescriber is pending",
    input="rx",
    message="Checking prescriber authorization",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "rx": "<rx number>",
    "prescriber": "<prescriber from the record>",
    "authorized_days_supply": "<30 or 90>",
    "refills_authorized": 1,
    "pending_request": false,
    "requested_on": "",
    "status": "<authorization status and how long it lasts>"
}

check_delivery_eligibility(
    desc="Check whether a prescription can be delivered to the patient's address, and the alternatives when it cannot",
    input="rx, address?",
    message="Checking delivery eligibility",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "rx": "<rx number>",
    "eligible": true,
    "reason": "<why it can or cannot be delivered>",
    "delivery_window": "<day and time window>",
    "fee": "<delivery fee>",
    "alternatives": ["<another way to get it>"]
}

find_stores(
    desc="Find Walgreens stores near a ZIP code or address, with pharmacy hours and distance",
    input="location, service?",
    message="Finding nearby stores",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "location": "<ZIP code or address searched>",
    "stores": [
        {"store": "<Walgreens store name and number>", "address": "<street address>", "distance": "<miles>", "pharmacy_hours": "<pharmacy hours>"}
    ]
}

get_disclosure(
    desc="Get the approved verbatim script for a required disclosure or consent, such as SMS prescription alerts",
    input="topic",
    message="Getting the approved disclosure",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "topic": "<disclosure topic>",
    "disclosure_text": "<the approved script, word for word, ending with the consent question when consent is needed>",
    "requires_consent": true,
    "source": "<policy file name in kb/>"
}

lookup_policy(
    desc="Look up a company policy that the knowledge base does not cover, such as returns, delivery or pickup by someone else",
    input="topic",
    message="Looking up the policy",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "topic": "<policy topic>",
    "policy": "<the policy in one or two sentences>",
    "applies_to": "<what it covers>",
    "source": "<policy file name in kb/>"
}

find_pharmacy(
    desc="Look up another pharmacy (CVS, Walgreens or any other chain) by name and location, with its phone number for a transfer",
    input="name, location",
    message="Looking up the pharmacy",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "pharmacy": "<pharmacy name>",
    "address": "<street, city, state ZIP>",
    "phone": "<phone number>",
    "fax": "<fax number>",
    "npi": "<10-digit NPI>",
    "pharmacy_hours": "<pharmacy hours>"
}

check_transfer_status(
    desc="Check where a submitted prescription transfer stands and when it is expected to be ready",
    input="transfer_id",
    message="Checking the transfer",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "transfer_id": "<transfer id from the submitted transfer>",
    "status": "<where the transfer stands>",
    "expected_ready": "<when it is expected to be ready, per the transfer policy>",
    "to": "<receiving store name and number>"
}

verify_representative(
    desc="Check whether a caller who is not the patient is listed as an authorized representative on the patient's record",
    input="patient, representative, relationship",
    message="Checking the representative",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "patient": "<patient full name>",
    "representative": "<representative full name>",
    "relationship": "<relationship to the patient>",
    "authorized": true,
    "scope": "<what the representative may handle>",
    "on_file_since": "<MM/DD/YYYY>"
}

check_savings_options(
    desc="Check manufacturer coupons, discount cards and plan options for a prescription, and whether each can be used with the patient's plan",
    input="rx",
    message="Checking savings options",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "rx": "<rx number>",
    "manufacturer_coupon": "<available coupon, or why none applies>",
    "coupon_with_plan": "<whether the coupon can be combined with this plan>",
    "discount_card_price": "<discount card price and days' supply>",
    "best_option": "<the cheapest valid option and its price>",
    "source": "<policy file name in kb/>"
}

request_refill(
    desc="Submit a refill request for a prescription at a store, optionally as a different days' supply",
    input="rx, store, days?",
    message="Requesting the refill",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "request": "Submitted",
    "rx": "<rx number>",
    "store": "<pickup store name and number>",
    "days_supply": "<30 or 90>",
    "estimated_ready": "<day and time it will be ready>"
}

update_patient_preferences(
    desc="Update the patient's contact channel for notifications or their preferred days' supply on file",
    input="patient, contact_channel?, fill_days?",
    message="Updating preferences",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "patient": "<patient full name>",
    "contact_channel": "<new contact channel>",
    "fill_days": "<30 or 90>",
    "updated": true
}

rerun_claim(
    desc="Resubmit the insurance claim for a prescription, optionally as a 90-day supply",
    input="rx, days",
    message="Rerunning the claim",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "result": "<claim result>",
    "days_supply": "<30 or 90>",
    "copay": "<copay for that supply, from the record>",
    "ready_for_pickup": "<day and time it will be ready>",
    "store": "<pickup store name and number>"
}

vaccine_slots(
    desc="Check vaccine eligibility and coverage for the patient and list open appointment slots at a store",
    input="store, vaccine, date?",
    message="Finding vaccine slots",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "eligible": true,
    "last_dose": "<MM/DD/YYYY from the record, or None on file>",
    "coverage": "<what the plan covers>",
    "open_slots": ["<time>", "<time>", "<time>"],
    "walk_in_wait": "<current walk-in wait>"
}

book_appointment(
    desc="Book a vaccine appointment slot for the patient at a store",
    input="patient, store, vaccine, slot",
    message="Booking the appointment",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "confirmation": "<confirmation number>",
    "when": "<day and time booked>",
    "where": "<store name and number>",
    "bring": "<what to bring>",
    "record": "<where the shot will be recorded>"
}

send_confirmation(
    desc="Send a confirmation by text message or email using the contact details on file",
    input="channel, message",
    message="Sending the confirmation",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "sent": true,
    "channel": "<SMS or Email>",
    "to": "<masked phone or email on file>",
    "message": "<the confirmation text that was sent>"
}

enroll_text_alerts(
    desc="Enroll the patient in automated prescription text alerts after the approved SMS disclosure was read and the caller gave affirmative consent",
    input="phone, consent",
    message="Enrolling in text alerts",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "enrolled": true,
    "channel": "SMS",
    "to": "(***) ***-<last 4 digits>",
    "alerts": "<alert types enrolled>",
    "consent_recorded": "<how and when consent was given>",
    "opt_out": "Reply STOP to any alert"
}

transfer_rx(
    desc="Move a prescription to another Walgreens store or request a transfer from another pharmacy",
    input="rx, destination, from?",
    message="Submitting the transfer",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "request": "Submitted",
    "transfer_id": "<new transfer id>",
    "to": "<receiving store name and number>",
    "ready": "<when it is expected to be ready, per the transfer policy>"
}

page_pharmacist(
    desc="Warm-transfer the call to the on-duty pharmacist for a clinical question while the agent stays on the line",
    input="patient, reason",
    message="Paging the pharmacist",
    dynamic=true,
    auto_approved=false
) -> {
    "demo_mode": true,
    "status": "Pharmacist paged",
    "pharmacist": "<on-duty pharmacist name>, PharmD",
    "joining_in": "<about how long until they join>",
    "reason": "<the clinical question, in a few words>"
}

log_summary(
    desc="Write the call summary to the interaction record",
    input="summary",
    message="Logging the call",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "logged": true,
    "interaction_id": "<new interaction id>",
    "summary": "<one-line summary of what was resolved on this call>"
}
