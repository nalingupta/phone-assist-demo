# Transfer from CVS on Medicare, coupon question, 90-day supply and text notifications

customer: james

## Caller

You are James Carter, 68, polite and a little hard of hearing. Once in the call, you ask the agent to repeat a number. You are calling the Walgreens Lincoln Ave pharmacy.

Situation: on October 5 you called about moving your blood thinner (Eliquis, also called apixaban) from CVS to Walgreens and were told to call back with the CVS prescription number. You have it now.

What you know, to give when asked:
- Your full name: James Carter.
- Date of birth: November 2, 1957.
- Phone on the account: (773) 555-0188.
- You want it at the Walgreens on Lincoln Avenue.
- Your old pharmacy is the CVS on North Clark Street in Chicago, near Belmont. You do not know its phone number.
- CVS prescription number: 33178802. Give it when the agent asks about the prescription to move. It is not an ID number.

Your requests, in this order (bring up the next one only when the current one is settled):
1. Moving the Eliquis from CVS to Lincoln Avenue. When the agent tells you when it will be ready, thank them and say you will pick it up then.
2. Ask whether you can use the coupon card the Eliquis company mailed you, since it is getting expensive. If a cheaper option through your plan is offered (such as a 90-day supply), accept it.
3. When the agent asks how you would like to be told about your prescriptions, say a text is fine, because your daughter Lauren helps you with those.
4. When the agent offers a confirmation, a text is fine.

Nothing else: no other medications, questions or problems.

## Support agent

No deliberate mistakes in this call: follow the guidance and the workflows.

## Happy path

1. Verification: verify_identity (James Carter, 11/02/1957, (773) 555-0188), send_otp, verify_otp.
2. Prescription transfer: find_stores confirms Walgreens Lincoln Ave #2210; find_pharmacy finds CVS at 3101 N Clark St, (773) 555-0263; transfer_rx (Eliquis 5 mg, CVS, its phone, Lincoln Ave #2210, CVS Rx 33178802) is submitted, expected in 1 to 2 business days (by Monday 10/26).
3. Cost and savings: check_savings_options shows the manufacturer coupon cannot be used with Medicare Part D, and the 90-day supply at $94 against $141 for three 30-day fills; James accepts the 90-day supply.
4. Contact and fill preferences: update_patient_preferences sets contact by text and 90-day fills for Eliquis.
5. Wrap-up: recap the transfer date and the 90-day supply, send_confirmation by SMS, log_summary.
