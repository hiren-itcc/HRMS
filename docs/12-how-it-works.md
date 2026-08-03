# 12 — How the system works

A plain-language guide to what this HRMS does. No technical knowledge assumed.
If you are looking for how the pieces connect internally, read
[13-data-map.md](./13-data-map.md). If you are putting it on a server, read
[14-production-setup.md](./14-production-setup.md).

---

## What this system is

It is the software a company uses to run its people admin: keeping staff
records, tracking who worked which days, handling holiday requests, running
monthly payroll, storing documents, and posting company news. One place instead
of a folder of spreadsheets.

---

## Two ideas to get straight first

Almost every misunderstanding about this system comes from one of these two.

### An employee and a login are different things

- An **employee** is the company's record *about a person*: their name, join
  date, department, salary, leave balance.
- A **login** is *a way to sign in*: an email address and a password.

They are kept separate on purpose. A factory worker who never touches a computer
still needs an employee record so they get paid — but they may have no login at
all. Equally, an IT administrator might have a login without being on the
payroll.

When someone is given access, their login is attached to their employee record,
and from then on the system knows that the person signing in *is* that employee.
That link is what lets the system show you "your" payslip and "your" leave.

### Everything belongs to one company

Every record — every person, every payslip, every announcement — is filed under
one company. The system is built so several companies could use the same
installation without ever seeing each other's data. Most installations only ever
hold one.

---

## Who can do what

There are five standard roles. A person has exactly one.

| Role | What they can do |
|---|---|
| **Employee** | Their own things only: clock in and out, request leave, see their own payslips and documents, read announcements. |
| **Manager** | Everything an employee can, plus see and approve for **the people who report to them**. |
| **HR** | Everything across the whole company: hire, edit and offboard staff, approve anything, configure the company setup, set salaries and run payroll. |
| **Finance** | An ordinary employee for their own affairs, plus the power to **approve and pay** payroll, and to view and export reports. |
| **Admin** | Everything, including settings, roles and the audit trail. |

### The one rule worth reading twice

**HR can set salaries but cannot approve or pay payroll.
Finance can approve and pay payroll but cannot change salaries.**

This is deliberate, and it is the most important safeguard in the system. It
means no single person can both decide what someone is paid *and* release the
money. Splitting those two powers is a standard financial control; it is why the
two roles exist separately rather than as one "money" role.

Roles can be edited by an administrator. One thing the system will not let you
do is remove the last person who can manage settings or roles — otherwise
everybody would be locked out of the controls with no way back in.

---

## Setting up the company

Done once, usually by HR, before anyone else uses the system. Everything else
reads from it.

- **Departments** — Engineering, Sales, and so on. They can nest: "Platform"
  can sit inside "Engineering". Each can have a head.
- **Job titles** — the list of positions people can hold.
- **Locations** — offices and branches, each with its own timezone. A location
  can be a head office, a branch, remote, or a client site.
- **Employment types** — full-time, part-time, contract, intern.
- **Shifts** — working hours, e.g. 09:30–18:30, plus a *grace period* (by
  default 15 minutes) before someone counts as late.
- **Holiday calendar** — public holidays. A holiday can apply to the whole
  company or to just one location, which matters when offices are in different
  regions.

---

## A new person joins

HR creates the employee record: name, contact details, join date, which
department and location, which shift, and who they report to.

A few things happen automatically:

- They get an **employee code** (like `EMP-0007`), taking the next free number.
- If they are given a login, it is created **at the same moment** as the
  employee record — the system will never end up with one and not the other.
- Their first password is a shared default, and they **must change it** the
  first time they sign in.

The system refuses to create a **circular reporting line** — you cannot make
someone their own manager, directly or through a chain. Without that check an
approval could have nowhere to go.

**Bank details** are treated as more sensitive than the rest of the record. The
employee can see their own, and HR can see them; a direct manager cannot.

**When someone leaves**, their record is not erased. It is marked as removed and
disappears from lists, but the history stays — their old payslips and attendance
still exist, because deleting them would corrupt last year's accounts. Their
login is disabled and they are signed out everywhere immediately.

---

## Every working day: attendance

People clock in when they start and clock out when they stop — as many times a
day as they need to. Lunch, a client visit, an evening stint: each is its own
session, and the day adds them up. Clocking out is never the end of the day, so
doing it by accident costs nothing; clocking straight back in within a couple of
minutes simply resumes the session, leaving no trace of the mistake.

Tapping clock-in twice without leaving does nothing the second time, so a double
tap still can't create a mess.

Each sitting also records **where**: office, remote, or a client site. If the
browser will say where the person is, that position is taken at the moment of
the punch — never in between — and an "office" claim is checked against the
office's own coordinates.

The check is deliberately gentle. Nobody is ever stopped from clocking in. A
refused permission, an old phone or a position too vague to mean anything all
read as *unverified*, which is a different answer from *not there* and is never
treated as one. Only a precise position that clearly is not at any office is
flagged, with the distance shown, for a human to make sense of. And a remote day
stores no coordinates at all — that would be somebody's home, and the mode
already says everything the business needs.

A day worked entirely from home is recorded as **work from home**; mix a remote
morning with an afternoon in the office and it is simply a present day.

The system decides how each day counts:

- **Late** — arriving after the shift start *plus* the grace period, measured in
  the employee's own timezone, not the head office's.
- **Half day** — working less than half the shift's length, counting every
  session but not the gaps between them: an hour out for lunch is not paid, and
  a day is never judged while someone is still clocked in.
- Days are also recorded as absent, on leave, a holiday, a week off, or working
  from home.

**Nothing is calculated overnight.** A day's status is worked out at the moment
someone looks at it, in this order: a real clock-in wins; otherwise, was the
person even employed on that date; then is it a holiday; then is it a weekend;
then is there approved leave; otherwise it is an absence. Approved leave always
beats "absent" — someone on booked holiday is never marked down as absent.

Only one attendance record can exist per person per day, so two entries can
never disagree. The day's sessions hang off that one record and its times are
only ever their total — first clock-in, last clock-out, hours added up.

Someone who leaves without clocking out keeps an open session. Their day shows
that plainly and counts none of those hours, which is a correction to raise
rather than something the system guesses at overnight.

### When a day is wrong

The employee raises a **correction request** — "I was here on the 12th, I forgot
to clock in." Their manager approves or rejects it. Approving rewrites that day's
sessions in the same action, so the record and the approval can never tell
different stories. Giving both times describes the whole day and replaces it;
giving one moves just that edge, which leaves the other sittings of a split day
alone. Only one correction can be open per person per day, and nobody can approve
their own.

---

## Taking time off: leave

HR sets up the **leave types** — casual, sick, earned, unpaid — each with an
annual allowance, and whether unused days can be carried into next year.

When someone requests leave:

- **Weekends and public holidays inside the dates are not counted.** A Friday-to-
  Monday request uses two days, not four.
- Requests that **overlap** existing ones are refused.
- The system checks there are enough days left, unless the company has chosen to
  allow negative balances.
- Some leave types can be set to need no approval and book instantly.

Approval deducts the days from the balance in the same action. The balance is
re-checked at that moment, because another request may have used the days up
while this one was waiting.

**Cancelling** depends on timing. Not started yet? The employee can cancel it
themselves and the days come back. Already begun? Only HR can, because payroll
may already have counted it.

The **leave year** does not have to be January to December — many companies run
April to March. Each request permanently records which leave year it belonged
to when it was made, so changing the policy later can never retrospectively
shuffle bookings between years.

---

## Getting paid: payroll

The largest part of the system.

### What someone is paid

A **salary structure** is a template: basic pay, allowances, deductions. Each
line is either a fixed amount, a percentage of basic, a percentage of total
cost, a statutory calculation, or the "balance" line that absorbs whatever is
left over.

Each employee is assigned a structure with a total figure and a date it takes
effect from. **Salary history is never overwritten.** A raise adds a new entry
from its effective date; the old one stays. The salary on any past date is
simply the most recent entry on or before it — which is how a payslip from two
years ago still shows the right figure.

### The monthly run

A payroll run covers one month for the company. There can only ever be one per
month. It moves through stages:

1. **Draft** — created, nothing calculated.
2. **In review** — figures calculated. Can be recalculated as often as needed.
3. **Approved** — signed off by Finance.
4. **Locked** — no further edits.
5. **Published** — employees can now see their payslips.

Before calculating, a **pre-flight check** lists problems: anyone without a
salary assigned stops the run; anyone missing bank details is only a warning.

Recalculating **rebuilds every payslip from scratch** rather than patching the
old figures. It is the only way to guarantee that someone removed from the run
since last time actually disappears.

**A locked or published run can never be reopened.** If a mistake is found after
publishing, it is corrected in the *next* month's run as an adjustment. This is
normal payroll practice: a payslip that has been issued is a document the
employee already has, and quietly changing it is worse than correcting it
openly.

**Employees only see a payslip once the run is published.** Before that the
numbers are still moving, and a payslip seen once cannot be unseen.

### How the figures are worked out

Earnings are resolved in order — basic first, since other lines are percentages
of it, and the balance line last.

Deductions come off in **priority order** when there isn't enough to cover
everything: statutory first (provident fund, insurance, professional tax), then
tax, then contractual deductions, then discretionary ones like loan recovery.

**Pay never goes negative.** Anything that could not be taken is recorded on the
payslip as a shortfall carried forward, rather than silently vanishing.

Pay is reduced proportionally for people who joined or left mid-month, and for
unpaid leave and unexplained absences.

Statutory rates are **configurable in settings**, not fixed in the software, so
they can be updated when the law changes. Income tax deducted at source is
entered by hand per employee — calculating it properly needs annual projections
and investment declarations the system does not hold.

### Paying

Once published, payments are tracked per payslip: pending, processing, paid, or
failed. A failed payment must be given a reason, and can be retried. Paid and
cancelled are final.

**Every payslip stores its own copy** of the employee's name, department, job
title and bank details as they were on the day it was calculated. If someone is
later renamed, promoted or transferred, old payslips still read correctly.

---

## Documents

Personnel files — CVs, offer letters, ID documents — organised into folders that
HR defines.

Only PDFs, Word documents and common image formats are accepted, up to a size
limit (10 MB by default). Employees can see and upload their own; managers can
see their team's; HR sees everything.

Deleted documents are hidden but the file itself is kept, because in a dispute
about what was on file, "we deleted it" is not an answer. A folder cannot be
deleted while documents are still in it.

---

## Company news: announcements

Posts that can go to everyone, or to one department, or to one location. They
can be categorised, given a priority, pinned, scheduled to appear later, and set
to expire.

Targeting is enforced when the posts are fetched, not merely hidden on screen —
a post aimed at one department genuinely does not reach anyone else. The system
tracks who has read what, so unread counts are accurate.

---

## Seeing the numbers: reports

Headcount and joiners/leavers, attendance summaries, leave usage, and
department-by-department breakdowns. Each can be downloaded as a spreadsheet.

**Viewing and exporting are separate permissions.** A manager may be allowed to
see their team's figures on screen without being able to download the underlying
data. Every export is recorded in the audit trail before the file is handed
over.

Managers see only their own reports; HR sees the whole company. All reports draw
on the same underlying figures, so two reports can never disagree.

---

## Keeping records honest: audit

Every meaningful change — hiring, approving leave, revising a salary, approving
payroll, changing settings — is written to an audit log with who did it, when,
and what changed. Salary and payroll entries record the before and after
figures.

The log deliberately keeps no link to the person who caused an entry, so that
deleting a user account can never delete or break the record of what they did.

---

## Settings

Company-wide options:

- **Working week** — which days are weekends.
- **Leave** — which month the leave year starts, whether negative balances are
  allowed.
- **Payroll** — currency, pay day, statutory rates and thresholds, and how
  unpaid days are pro-rated.
- **Modules** — which sections appear in the menu.

One warning about that last one: **hiding a module only hides the menu entry.**
It does not remove anyone's access. If you need someone not to see payroll,
change their role — do not rely on the menu toggle.

---

## Things the system does not do yet

Being straight about this is more useful than a feature list:

- **Password reset emails are not delivered.** The screen works, but no email is
  actually sent, because no mail service is connected yet. In practice an
  administrator has to reset passwords for people.
- **Payslips cannot be downloaded as PDFs** — data exports are spreadsheets.
- **There is no mobile app.**
- **Companies cannot sign themselves up.** A new company has to be created on
  the server (see [14-production-setup.md](./14-production-setup.md)).
