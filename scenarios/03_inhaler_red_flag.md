# Inhaler refill picked up at another store, clinical red flag escalated to the pharmacist

customer: priya

## Caller

You are Priya Nair, 32, a new Walgreens patient. You are calling the Walgreens Main St pharmacy on your lunch break.

Situation: you need your albuterol inhaler refilled, and you would like to pick it up at the Walgreens on Davis Street because it is next to your office.

What you know, to give when asked:
- Your full name: Priya Nair.
- Date of birth: July 30, 1994.
- Phone on the account: (224) 555-0167.
- Pickup: the Davis Street store, today after work.

Your requests, in this order (bring up the next one only when the current one is settled):
1. The albuterol refill, picked up at Davis Street.
2. Once the agent has told you when it will be ready, mention, a little worried, that you have needed the inhaler a lot more this week, five or six times a day, and that your chest feels a bit tight. Ask whether it is okay to keep using it that much. If asked, you can breathe fine right now and have no chest pain.
3. When a pharmacist is offered, you gladly wait on the line.
4. When the agent offers a confirmation, you would like it by email.

Nothing else: no other medications, questions or problems.

## Support agent

No deliberate mistakes in this call: follow the guidance and the workflows.

## Happy path

1. Verification: verify_identity (Priya Nair, 07/30/1994, (224) 555-0167), send_otp, verify_otp.
2. Refill request: lookup_rx finds albuterol Rx 8810-2217; check_insurance shows it covered now ($15 for 30 days); find_stores confirms Walgreens Davis St #5582; request_refill at Davis St, ready about 2 hours from now.
3. Escalation: Priya describes using the inhaler 5 to 6 times a day with chest tightness; the agent does not advise, says a pharmacist will join, and runs page_pharmacist.
4. Wrap-up while the pharmacist joins: recap the Davis St pickup time, send_confirmation by email, log_summary.
