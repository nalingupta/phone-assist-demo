# All simulated call scenarios (5)

Format notes (apply to every scenario below):
- "customer:" links the scenario to a customer record in data.js (USERS).
- "## Caller" is given only to the caller AI; "## Support agent" only to the support agent AI.
- "## Happy path" is the intended flow. Only the tool simulator is given it (as the intended outcome), so tool results follow it; the caller, agent and guidance AIs never see it.
- Each scenario has its own record, so a record only carries what fits that call.

---

# Scenario 1: Refill rejected by insurance, cheaper 90-day supply, flu shot add-on

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

1. Patient verification: find_patient (Maria Lopez, 03/14/1981, (312) 555-0142) finds her record; send_otp to the phone on file, verify_otp.
2. Insurance rejection: lookup_rx finds atorvastatin Rx 7731-2208; check_insurance shows the 10/18 claim rejected with code 79 (refill too soon), covered from 10/19, so covered now; the agent explains it was a timing rejection.
3. Cost and savings: Maria mentions the $30 copay; check_savings_options shows the 90-day supply at $45 against $90 for three 30-day fills (5 refills left, enough for it); she takes the 90-day supply.
4. Insurance rejection, step 4: rerun_claim as a 90-day supply; paid, $45, ready at Main St about 2 hours from now.
5. Immunization: vaccine_slots at Main St (last flu shot 10/09/2025, so due; covered at no cost); book_appointment for the first slot after the ready time.
6. Wrap-up: recap pickup and the flu shot time, send_confirmation by SMS, log_summary.

---

# Scenario 2: Transfer from CVS on Medicare, coupon question, 90-day supply and text alerts

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
3. Once the 90-day supply is set, ask whether the store could text you when your prescriptions are ready instead of calling, since you sometimes miss calls and your daughter Lauren helps you with texts. When the agent reads you the text alerts statement, say yes, you agree.
4. When the agent offers a confirmation, a text is fine.

Nothing else: no other medications, questions or problems.

## Support agent

No deliberate mistakes in this call: follow the guidance and the workflows.

## Happy path

1. Patient verification: find_patient (James Carter, 11/02/1957, (773) 555-0188) finds his record; send_otp to the phone on file, verify_otp.
2. Prescription transfer: find_stores confirms Walgreens Lincoln Ave #2210; find_pharmacy finds CVS at 3101 N Clark St, (773) 555-0263; transfer_rx (Eliquis 5 mg, CVS, its phone, Lincoln Ave #2210, CVS Rx 33178802) is submitted, expected in 1 to 2 business days (by Monday 10/26).
3. Cost and savings: check_savings_options shows the manufacturer coupon cannot be used with Medicare Part D, and the 90-day supply at $94 against $141 for three 30-day fills (the CVS prescription has 3 refills left, enough for it); James accepts the 90-day supply.
4. Contact and fill preferences: update_patient_preferences sets 90-day fills for Eliquis; the contact channel is unchanged.
5. Text alerts: get_disclosure returns the approved script from text_alerts.md for the number ending in 0188; the agent reads it word for word; James says yes; enroll_text_alerts.
6. Wrap-up: recap the transfer date and the 90-day supply, send_confirmation by SMS, log_summary.

---

# Scenario 3: Inhaler refill picked up at another store, clinical red flag escalated to the pharmacist

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

1. Patient verification: find_patient (Priya Nair, 07/30/1994, (224) 555-0167) finds her record; send_otp to the phone on file, verify_otp.
2. Refill request: lookup_rx finds albuterol Rx 8810-2217; check_insurance shows it covered now ($15 for 30 days); find_stores confirms Walgreens Davis St #5582; request_refill at Davis St, ready about 2 hours from now.
3. Escalation: Priya describes using the inhaler 5 to 6 times a day with chest tightness; the agent does not advise, says a pharmacist will join, and runs page_pharmacist.
4. Wrap-up while the pharmacist joins: recap the Davis St pickup time, send_confirmation by email, log_summary.

---

# Scenario 4: Refill before a trip, picked up at another store, text alerts sign-up

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

---

# Scenario 5: Daughter calls for her father, refill plus a question for the pharmacist

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

1. Representative verification: find_patient (James Carter, 11/02/1957, (773) 555-0188) finds James's record; verify_representative (patient James Carter, Lauren Carter, daughter) shows her on file since 03/02/2025 for refills, pickups and pharmacy questions; send_otp to James's phone, verify_otp with the code Lauren reads back.
3. Refill request: lookup_rx finds lisinopril Rx 5520-9031; check_insurance shows it covered now (77 percent of the 90-day fill from 08/14 used; $20 for 90 days); find_stores confirms Walgreens Lincoln Ave #2210; request_refill for 90 days, ready today and held for 7 days.
4. Escalation: the ibuprofen and Eliquis question is clinical; the agent does not answer it, says a pharmacist will join, and runs page_pharmacist.
5. Wrap-up while the pharmacist joins: recap the pickup, send_confirmation by SMS to James's phone, log_summary.

