# Data Breach Response Plan

**Applies to:** the dFortix.ai scooter-hire platform published by Mercury
Road Equipment Pty Ltd (ABN 36 614 422 187) and every deployed customer
instance of that platform.

**Regulatory basis:** Part IIIC (sections 26WA–26WT) of the *Privacy Act
1988* (Cth), which establishes the Notifiable Data Breaches (NDB) scheme
and the obligation to notify the Office of the Australian Information
Commissioner (OAIC) and affected individuals when an "eligible data
breach" occurs.

**Plan owner:** Platform Privacy Officer (Mercury Road Equipment Pty Ltd).

**Last reviewed:** 2026-04-21. **Next review due:** 2027-04-21 or
immediately following any eligible data breach, whichever is earlier.

---

## 1. Purpose and scope

This plan exists to ensure that any suspected or confirmed compromise of
personal information held or processed by the platform is detected,
contained, assessed and reported in a way that:

- meets every applicable statutory deadline;
- minimises harm to the individuals whose information was affected;
- preserves evidence so that the root cause can be understood and
  future breaches prevented;
- keeps each deployed customer (the data controller under APP 11)
  informed and able to discharge its own notification obligations.

It covers personal information in any form held in the platform's
databases, object storage, backups, logs, audit trail, error monitoring
service, email/SMS provider, payment provider or any other system under
platform control.

## 2. Two-layer responsibility model

Each incident involves two layers of responsibility. Both must act in
coordination.

| Layer | Role | Responsibilities |
|---|---|---|
| **Platform vendor** — Mercury Road Equipment Pty Ltd | Publisher of the software; operator of shared infrastructure where applicable. | Detect, contain and forensically investigate any platform-level compromise. Notify affected deployed customers as soon as practicable. Provide evidence and technical support for tenant-level assessment and notification. |
| **Deployed customer** (the data controller) | Operator of the deployed instance that collected the affected personal information. | Undertake the eligible-data-breach assessment under s 26WF. Notify the OAIC and affected individuals if an eligible data breach is confirmed. Operate tenant-specific incident communications. Retain ultimate accountability to affected individuals. |

The OAIC will hold the deployed customer accountable for its own
notification obligations even where the root cause was platform-level.
The platform vendor is accountable to the customer under its service
agreement and provides the evidence the customer needs to fulfil its
obligations.

## 3. Roles

### Platform side

- **Platform Privacy Officer** (Mercury Road Equipment) — primary
  decision-maker; triggers the plan; authorises external
  communications.
- **On-call engineer** — first responder; performs containment and
  evidence preservation.
- **Platform legal contact** — external counsel engaged on confirmed
  eligible data breaches.
- **Platform cyber insurer** — notified on any confirmed or suspected
  eligible data breach per the policy terms.

### Deployed-customer side (each customer defines its own)

- **Customer Privacy Officer** — primary point of contact for end-user
  complaints and access requests; leads the s 26WF assessment.
- **Customer operations lead / CTO equivalent** — co-ordinates internal
  response and tenant-specific communications.
- **Customer legal / cyber insurer** — engaged per the customer's own
  policies.

### Shared

- **OAIC liaison** — customer-led, platform-supported. Only the
  deployed customer has an APP-11 obligation to notify; the platform
  assists with evidence.

## 4. Detection sources

A breach may be detected through any of:

- Sentry error monitoring (unusual authentication errors, Prisma
  integrity errors, mass 500 responses).
- Stripe fraud signals or unusual payment patterns.
- Customer reports through support channels.
- Staff reports (e.g. a suspected social-engineering call).
- Automated anomaly jobs: no-show detector, stuck-webhook recovery,
  maintenance alerts, future failed-login burst detector.
- Third-party disclosure (a researcher, a sub-processor, OAIC
  notification originating externally).
- Backup or audit-log integrity failures.

## 5. Triage procedure (first 4 hours)

**Step 1 — Log the incident.** Create a record in the incident log with:
reference number (`INC-YYYYMMDD-###`), detection source, time of
detection, time of suspected compromise, systems affected, types of
personal information potentially involved, initial reporter.

**Step 2 — Classify severity.**

| Severity | Definition |
|---|---|
| P1 (Critical) | Confirmed or highly likely exfiltration of identified PII at scale (>100 records), or any exposure of licence/passport numbers or payment tokens. |
| P2 (High) | Suspected exfiltration of identified PII; confirmed exposure of contact details at scale; confirmed internal mis-access. |
| P3 (Medium) | Isolated, limited-scope exposure (one record, internal-only); confirmed no external access. |
| P4 (Low) | Near-miss, attempted but blocked (e.g. mass-login spray caught by lockout). |

**Step 3 — Containment actions.** Triggered based on severity. Every
containment action must be recorded in the incident log with actor,
time and justification.

- Revoke sessions: use the admin session-revocation tRPC procedure to
  invalidate suspect sessions.
- Rotate credentials: rotate API keys, service account credentials and
  webhook-signing secrets per the secret-rotation runbook
  ([`docs/ops/secret-rotation-runbook.md`](secret-rotation-runbook.md)).
- Rate-limit or block source IPs at the ingress layer.
- Quarantine affected customer records (flag for review, do not
  delete).
- For payment data: notify Stripe immediately; Stripe has its own
  fraud-response channel.

**Step 4 — Evidence preservation.** Take a snapshot of:
- relevant audit log rows (query and export as JSON; audit rows are
  append-only but export protects against later retention purge);
- Sentry events for the affected window;
- application logs for the affected window;
- a database backup snapshot of the affected tables.

Store snapshots in write-locked storage distinct from normal backups.

**Step 5 — Escalate.** Notify the Platform Privacy Officer for all P1
and P2. Notify the affected deployed customer for all P1, P2 and any
P3 where the customer's end users are involved.

## 6. Assessment under the Notifiable Data Breaches scheme

Once a breach is suspected, the deployed customer has **30 days** under
s 26WF to assess whether it is an "eligible data breach" requiring
notification. The platform vendor assists with all technical evidence.

An eligible data breach has three elements (s 26WE):

1. There is unauthorised access to, unauthorised disclosure of, or loss
   of, personal information held by the entity.
2. The access, disclosure or loss is likely to result in serious harm
   to any of the individuals to whom the information relates.
3. The entity has not been able to prevent the likely risk of serious
   harm with remedial action.

Factors bearing on the "serious harm" test (s 26WG):

- Kind of information (sensitive information such as licence numbers,
  financial information and health information weighs towards serious
  harm).
- Sensitivity and volume.
- Whether the information is protected by security measures (e.g.
  encryption at rest) such that it would be unusable to an
  unauthorised recipient.
- The person(s) who obtained the information.
- The nature of the possible harm: financial fraud, identity theft,
  physical safety, psychological harm, workplace or reputational harm.

The assessment must be documented in the incident record. If at the end
of the assessment the breach is not an eligible data breach, reasons
must be recorded.

## 7. Notification decision tree

Once an eligible data breach is confirmed:

```
             ┌──────────────────────────────────────┐
             │ Platform vendor detects or suspects  │
             │ a breach.                            │
             └──────────────────────────────────────┘
                             │
                             ▼
             ┌──────────────────────────────────────┐
             │ Platform vendor notifies the         │
             │ deployed customer AS SOON AS         │
             │ PRACTICABLE (always, regardless of   │
             │ eligibility assessment outcome).     │
             └──────────────────────────────────────┘
                             │
                             ▼
             ┌──────────────────────────────────────┐
             │ Deployed customer conducts s 26WF    │
             │ assessment within 30 days.           │
             └──────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   Not eligible:                  Eligible data breach:
   document reasons,              deployed customer notifies
   retain record.                 OAIC using the online form
                                  AS SOON AS PRACTICABLE.
                                          │
                                          ▼
                                  Deployed customer notifies
                                  affected individuals per
                                  s 26WL (content requirements
                                  below).
```

### OAIC notification

The OAIC form requires:

- the deployed entity's identity and contact details;
- a description of the eligible data breach;
- the kind of information concerned;
- recommendations about the steps that individuals should take in
  response.

Submit via <https://www.oaic.gov.au/privacy/notifiable-data-breaches/report-a-data-breach>.

### Individual notification (s 26WL)

Notice to affected individuals must include:

- the identity and contact details of the entity;
- a description of the eligible data breach;
- the kind of information concerned;
- recommended steps for the individual to take in response.

Notification method, in order of preference: direct email to the
individual's notified address; SMS if no email on file; prominent
notice on the deployed customer's website if direct contact is not
practicable.

## 8. Communications plan

Templates are maintained in Appendix A–C. They are not filled in at
incident time — they are tailored to the specific facts of the
incident.

- **Holding statement** for external enquiries (press, researchers,
  individual customers) during the assessment window. Does not admit
  liability.
- **Customer email template** for the individual notification under
  s 26WL.
- **OAIC submission narrative** for the online form.

During an active incident, all external communications go through the
Platform Privacy Officer (platform side) and the Customer Privacy
Officer (customer side). No engineer communicates externally on the
record without clearance.

## 9. Post-incident review

Within 14 days of incident resolution, the Platform Privacy Officer
convenes a post-incident review covering:

- timeline of detection, containment, assessment, notification;
- root cause;
- gaps in detection, containment, notification or communications;
- remediation actions with owners and due dates;
- whether this plan needs to be updated.

Output is a written retrospective stored alongside the incident record.
Remediation actions are tracked to completion.

## 10. Plan maintenance

- **Review cadence:** annual at minimum; immediately following any
  eligible data breach; whenever a material change is made to
  authentication, authorisation, encryption, backup or notification
  infrastructure.
- **Training:** all engineers with production access complete an
  annual tabletop exercise against this plan.
- **Testing:** one unannounced tabletop per year initiated by the
  Platform Privacy Officer.

---

## Appendix A — Incident record template

```
INC-YYYYMMDD-###

Detected:            <timestamp> (Australia/Brisbane)
Detected via:        <Sentry | customer report | staff | automated job | other>
Reported by:         <name, role>
Initial severity:    <P1 | P2 | P3 | P4>
Systems affected:    <list>
PI categories at risk:
  □ Contact details (name, email, phone, address)
  □ Driver licence (number, state, class, expiry, images)
  □ Passport (number, country, expiry, image)
  □ Date of birth
  □ Emergency contact
  □ Booking / rental records
  □ Payment method tokens
  □ Signatures / inspection photographs
  □ Other: __________________________

Affected deployed customers: <list>
Approximate record count: <number>

Containment timeline:
  <time> — <action> — <actor>
  ...

Assessment decision (s 26WF):
  □ Not eligible — reasons recorded at: <path>
  □ Eligible — OAIC notified at: <time>, affected individuals notified at: <time>

Root cause:
Remediation actions (owner, due date):
Post-incident review date:
```

## Appendix B — OAIC notification form checklist

Before submitting the online form, confirm:

- [ ] Entity name and ABN of the deployed customer
- [ ] Privacy Officer contact details
- [ ] Date(s) of the eligible data breach
- [ ] When and how the breach was detected
- [ ] Kinds of personal information involved
- [ ] Number of individuals affected (exact or estimated)
- [ ] Circumstances of the breach (unauthorised access / disclosure /
      loss)
- [ ] Remedial action taken
- [ ] Whether affected individuals have been notified (and if not yet,
      planned timing)
- [ ] Recommended steps for affected individuals
- [ ] Supporting documents attached

## Appendix C — Individual notification template

```
Subject: Important notice about your {{siteName}} account

Dear {{firstName}},

We are writing to let you know about a data security incident that has
affected personal information we hold about you.

What happened:
{{plain-English description, no technical jargon}}

What information was involved:
{{bulleted list — only fields actually affected for this individual}}

What we are doing about it:
{{containment + remediation actions, in past tense}}

What you should do:
{{specific, actionable steps — e.g. watch for suspicious emails,
reset passwords, monitor payment statements}}

For questions about this notice, contact our Privacy Officer at
{{privacyEmail}}.

If you are not satisfied with our response, you may also contact the
Office of the Australian Information Commissioner at oaic.gov.au.

Yours sincerely,
{{Customer Privacy Officer name}}
{{legalName}}
```

## Appendix D — Escalation contact matrix (deployed-customer template)

Each deployed customer completes the following before going live:

| Role | Name | Email | Phone (24x7) |
|---|---|---|---|
| Customer Privacy Officer | | | |
| Customer CTO / ops lead | | | |
| External legal counsel | | | |
| Cyber insurer — policy # | | | |
| OAIC — <https://www.oaic.gov.au/> | (public) | (public) | (business hours) |

Platform-side escalation (constant across all deployments):

| Role | Contact |
|---|---|
| Platform Privacy Officer | Mercury Road Equipment Pty Ltd — <privacy@dfortix.ai> (or as published in the customer's service agreement) |
