<!-- Demo tools. Each "tool_name( ... ) -> output" block defines a mock tool the agent can call.
       desc:    (optional) what the tool does — helps the model decide when to call it
       input:   (optional) comma-separated argument names the model should provide
       message: (optional) status text shown to the user while the tool runs
       dynamic: (optional) true = an AI generates the result at call time so it fits
                the conversation; the output after -> becomes the format to imitate AND
                the fallback if generation fails. Omit it (or set false) to always
                return the output verbatim.
       auto_approved: always true in this pack: every tool runs without an
                approval gate. Consent before a binding action is asked for in the
                conversation, not by the tool.
       output:  everything after "->" until the next block: the text returned to the
                model, written as pretty-printed multi-line JSON. Static when dynamic
                is off; the example format when dynamic is on.
     String values are "quoted"; booleans are bare true/false. -->

verify_identity(
    desc="Match the caller's name, date of birth and phone against the patient record before any prescription detail is discussed",
    input="name, dob, phone",
    message="Verifying the caller",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "match": true,
    "patient": "Maria Lopez",
    "date_of_birth": "03/14/1981",
    "identifiers_checked": "name, date of birth, phone",
    "next_step": "Send a one-time passcode to the phone on file"
}

send_otp(
    desc="Send a six-digit one-time passcode by SMS to the phone number on file",
    input="phone",
    message="Sending the passcode",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "sent": true,
    "to": "(***) ***-0142",
    "code_demo_only": "482913",
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
    input="patient, query",
    message="Looking up prescriptions",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "found": 1,
    "prescriptions": [
        {"rx": "7731-2208", "drug": "Atorvastatin 20 mg tablet", "refills_left": 2, "last_fill": "09/21/2026", "status": "Refill requested, claim rejected 10/18"}
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
    "plan": "BlueCross BlueShield PPO",
    "plan_status": "Active",
    "latest_claim": "Rejected, code 79 (refill too soon)",
    "days_supply_used": "68%",
    "eligible_date": "10/24/2026",
    "copay_30_day": "$30.00",
    "copay_90_day": "$12.00",
    "prior_authorization": "Not required"
}

rerun_claim(
    desc="Resubmit the insurance claim for a prescription, optionally as a 90-day supply",
    input="rx, days",
    message="Rerunning the claim",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "result": "Approved",
    "days_supply": "90",
    "copay": "$12.00",
    "ready_for_pickup": "Today after 4:30 PM",
    "store": "Walgreens Main St (#4471)"
}

vaccine_slots(
    desc="Check vaccine eligibility and coverage for the patient and list open appointment slots at a store",
    input="store, vaccine, date",
    message="Finding vaccine slots",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "eligible": true,
    "last_flu_shot": "10/09/2025",
    "coverage": "$0 copay",
    "open_slots": ["4:40 PM", "5:00 PM", "5:20 PM", "6:10 PM"],
    "walk_in_wait": "About 25 minutes"
}

book_appointment(
    desc="Book a vaccine appointment slot for the patient at a store",
    input="patient, store, vaccine, slot",
    message="Booking the appointment",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "confirmation": "FLU-88213",
    "when": "Today 4:40 PM",
    "where": "Walgreens Main St (#4471)",
    "bring": "Insurance card and photo ID",
    "record": "In the app and state registry within 24 hours"
}

send_confirmation(
    desc="Send a confirmation by text message or email using the contact details on file",
    input="channel, message",
    message="Sending the confirmation",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "sent": true,
    "channel": "SMS",
    "to": "(***) ***-0142",
    "message": "Walgreens Main St: your prescription is ready for pickup today after 4:30 PM."
}

transfer_rx(
    desc="Move a prescription to another Walgreens store or request a transfer from another pharmacy",
    input="rx, destination, from",
    message="Submitting the transfer",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "request": "Submitted",
    "transfer_id": "TR-55102",
    "to": "Walgreens Davis St (#4488)",
    "ready": "In about 15 minutes"
}

page_pharmacist(
    desc="Warm-transfer the call to the on-duty pharmacist for a clinical question while the agent stays on the line",
    input="patient, reason",
    message="Paging the pharmacist",
    dynamic=true,
    auto_approved=true
) -> {
    "demo_mode": true,
    "status": "Pharmacist paged",
    "pharmacist": "R. Chen, PharmD",
    "joining_in": "About 2 minutes",
    "reason": "Rescue inhaler use 5 to 6 times a day"
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
    "interaction_id": "INT-204411",
    "summary": "Maria Lopez: refill-too-soon rejection resolved with a 90-day fill at $12; flu shot booked for 4:40 PM."
}
