# Users & roles

This is where you manage the people who work in the back office: inviting them,
setting their role, managing their sessions and enforcing two-factor sign-in.

## Inviting a team member

1. Open **Users & Roles** and create an invite with the person's email and the
   role they should have.
2. They receive an invite and set up their account.
3. On first sign-in they're required to enrol **two-factor authentication** —
   this is mandatory for every back-office account and can't be skipped.

## Choosing a role

Pick the least privilege that lets someone do their job:

| Role | Grant when… |
|---|---|
| **Staff** | They work the front desk: bookings, check-in/out, customers, comms. |
| **Manager** | They oversee a depot or team and need insights and analytics. |
| **Admin** | They configure the business: pricing, finance, integrations, users. |
| **Super Admin** | They own the platform and global settings. Keep this group tiny. |

Each role inherits the access of those below it.

## Managing sessions and security

- You can review and revoke active **sessions** for a user — use this if a device
  is lost or an account may be compromised.
- 2FA is enforced for everyone; you don't need to (and can't) turn it off per
  user.
- Role changes, invites and session revocations are recorded in the **Audit
  Log**.

## Good practice

- Remove access promptly when someone leaves.
- Review the Super Admin list periodically — it should be short.
- Don't share accounts; the audit trail relies on each action being attributable
  to one person.
