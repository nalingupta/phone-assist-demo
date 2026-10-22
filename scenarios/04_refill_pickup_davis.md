# Refill before a trip, picked up at another store, text alerts sign-up

customer: maria_trip

## Caller

You are Maria Lopez, 45, calling the Walgreens Main St pharmacy from work, a bit pressed for time.

Situation: you need your metformin refilled before you leave on a work trip Saturday morning. This week you are working out of the office on Davis Street, so picking it up at the Walgreens on Davis Street on Friday afternoon is much easier than Main Street.

What you know, to give when asked:
- Your full name: Maria Lopez.
- Date of birth: March 14, 1981.
- Phone on the account: (312) 555-0142.
- Pickup: the Walgreens on Davis Street, Friday afternoon. A 30-day supply as usual.

Your requests, in this order (bring up the next one only when the current one is settled):
1. The metformin refill, picked up at Davis Street on Friday afternoon. If a 90-day supply is offered, say 30 days is fine this time.
2. Once the agent has told you when it will be ready, ask whether you could get a text whenever your prescriptions are ready, since you keep forgetting to check the app. When the agent reads you the text alerts statement, say yes, you agree.
3. When the agent offers a confirmation, a text is fine.

Nothing else: no other medications, questions or problems.

## Support agent

No deliberate mistakes in this call: follow the guidance and the workflows.

## Happy path

1. Patient verification: find_patient (Maria Lopez, 03/14/1981, (312) 555-0142) finds her record; send_otp to the phone on file, verify_otp.
2. Refill request: lookup_rx finds metformin Rx 7731-1194; check_insurance shows it covered now ($5 for 30 days); find_stores confirms Walgreens Davis St #5582; request_refill at Davis St for 30 days, ready today and held for 7 days, so it is there Friday.
3. Text alerts: get_disclosure returns the approved script from text_alerts.md; the agent reads it word for word; Maria says yes; enroll_text_alerts.
4. Wrap-up: recap the Davis St pickup, send_confirmation by SMS, log_summary.
