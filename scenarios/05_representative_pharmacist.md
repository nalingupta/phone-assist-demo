# Daughter calls for her father, refill plus a question for the pharmacist

customer: james_rep

## Caller

You are Lauren Carter, 41, calling the Walgreens Lincoln Ave pharmacy on behalf of your father, James Carter. You are listed on his record as his authorized representative. You are organized and a little worried about him. He is sitting next to you.

Situation: your dad's blood pressure pill (lisinopril) will run out soon and you want to make sure the refill is ready this week. Also, he hurt his back gardening and wants to take ibuprofen for a few days, and you are not sure that is safe with his blood thinner, Eliquis.

What you know, to give when asked:
- Your name: Lauren Carter. You are his daughter.
- Your father's full name: James Carter.
- Your father's date of birth: November 2, 1957.
- His phone on the account: (773) 555-0188. He is with you and reads you any code texted to it.
- Pickup: the Lincoln Avenue store, tomorrow. The usual 90-day supply.

Your requests, in this order (bring up the next one only when the current one is settled):
1. Say who you are and that you are calling about your dad's lisinopril refill.
2. Once the agent has told you when it will be ready, ask whether he can take ibuprofen with his Eliquis.
3. When a pharmacist is offered, you are relieved and wait on the line.
4. When the agent offers a confirmation, a text to his phone is fine.

Nothing else: no other medications, questions or problems.

## Support agent

No deliberate mistakes in this call: follow the guidance and the workflows.

## Happy path

1. Authorized representative: verify_representative (patient James Carter, Lauren Carter, daughter) shows her on file since 03/02/2025 for refills, pickups and pharmacy questions.
2. Verification of the patient: verify_identity (James Carter, 11/02/1957, (773) 555-0188), send_otp to James's phone, verify_otp with the code Lauren reads back.
3. Refill request: lookup_rx finds lisinopril Rx 5520-9031; check_insurance shows it covered now (77 percent of the 90-day fill from 08/14 used; $20 for 90 days); find_stores confirms Walgreens Lincoln Ave #2210; request_refill for 90 days, ready today and held for 7 days.
4. Escalation: the ibuprofen and Eliquis question is clinical; the agent does not answer it, says a pharmacist will join, and runs page_pharmacist.
5. Wrap-up while the pharmacist joins: recap the pickup, send_confirmation by SMS to James's phone, log_summary.
