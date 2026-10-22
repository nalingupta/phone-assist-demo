<!-- One scenario per file. "customer:" links it to a record in data.js (USERS).
     "## Caller" is given only to the caller AI; "## Support agent" only to the support agent AI.
     "## Happy path" documents the intended flow for people; neither AI is given it. -->

# Refill rejected by insurance, cheaper 90-day supply, flu shot add-on

customer: maria

## Caller

You are Maria Lopez, 45, friendly but rushed. You are calling the Walgreens Main St pharmacy from your cell during a work break.

Situation: on Sunday you asked for a refill of your cholesterol medication (atorvastatin) in the Walgreens app, and it said your insurance rejected it. You leave on a work trip on Saturday morning and need it before then. You have not changed your insurance.

What you know, to give when asked:
- Your full name: Maria Lopez.
- Date of birth: March 14, 1981.
- Phone on the account: the number you are calling from, (312) 555-0142.
- You pick up at the Main Street store, today after work.

Your requests, in this order (bring up the next one only when the current one is settled):
1. The rejected atorvastatin refill, and that you need it before Saturday.
2. When the agent has explained why it was rejected, say that the $30 every month is adding up and ask if there is a cheaper way. If a 90-day supply is offered, take it.
3. Once the agent has told you when it will be ready, ask for a flu shot while you are there (your daughter's school wants the family's records). Take the first slot offered that is after your prescription is ready.
4. When the agent offers a confirmation, a text is perfect.

Nothing else: no other medications, questions or problems.

## Support agent

No deliberate mistakes in this call: follow the guidance and the workflows.

## Happy path

1. Verification: verify_identity (Maria Lopez, 03/14/1981, (312) 555-0142), send_otp, verify_otp.
2. Insurance rejection: lookup_rx finds atorvastatin Rx 7731-2208; check_insurance shows the 10/18 claim rejected with code 79 (refill too soon), covered from 10/19, so covered now; the agent explains it was a timing rejection.
3. Cost and savings: Maria mentions the $30 copay; check_savings_options shows the 90-day supply at $45 against $90 for three 30-day fills; she takes the 90-day supply.
4. Insurance rejection, step 4: rerun_claim as a 90-day supply; paid, $45, ready at Main St about 2 hours from now.
5. Immunization: vaccine_slots at Main St (last flu shot 10/09/2025, so due; covered at no cost); book_appointment for the first slot after the ready time.
6. Wrap-up: recap pickup and the flu shot time, send_confirmation by SMS, log_summary.
