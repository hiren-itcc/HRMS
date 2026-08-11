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
  can be a head office, a branch, remote, or a client site. Give one
  coordinates and a radius and attendance can tell, from where somebody is
  standing, whether their day is an office day. A location with no coordinates
  is not on the map and places nobody.
- **Employment types** — full-time, part-time, contract, intern.
- **Shifts** — working hours, e.g. 09:30–18:30, plus a *grace period* (by
  default 15 minutes) before someone counts as late.
- **Holiday calendar** — public holidays. A holiday can apply to the whole
  company or to just one location, which matters when offices are in different
  regions.

---

## Before they join: recruitment

Everything above starts with HR typing a person in. Recruitment is the part
that comes before that — the job, the people applying for it, who interviewed
them and what was said.

**A job opening** is raised with a title and as much of the rest as is settled:
department, location, employment type, how many people to hire, and a salary
band. Most of that is optional, because an opening is usually raised before all
of it is agreed. It starts as a **draft** and nothing can be applied to it
until somebody publishes it. Later it can be paused, closed, or marked filled —
and closing an opening that still has people live in its pipeline is refused,
because that would quietly orphan them.

**A candidate is a person, once.** Their email is unique within the company, so
somebody applying for a second role is the same human with a second
application, not a duplicate record. They are not an employee and the system is
careful about that: a candidate who is never hired leaves no employee record
behind, and a rejected application is not a deleted person.

**An application moves through four stages** — applied, screening, interview,
offer — and can end in three ways: rejected, withdrawn, or hired. It can also
move *backwards* while it is live, because a round being redone is ordinary and
refusing it would teach people to reject somebody and re-add them, which throws
away the reason the rejection was recorded.

**Rejecting asks why.** "Rejected" on its own answers nothing three months
later, and the reason is the only thing that tells a bad advert from a bad
interview loop. Choosing *Something else* additionally requires a sentence.

**Interview feedback is written once.** The interviewer records a
recommendation and their notes, and submitting **freezes** them. A
recommendation that can be rewritten after the decision is evidence of nothing.
If somebody's view genuinely changes, that is a second interview, not an edit.

**An offer** carries the agreed job and pay and a start date. It is drafted,
then marked sent, then their answer is recorded. Declining — or the company
withdrawing it — closes the application. Accepting does **not**, because the
person has not actually joined yet.

### Hiring is a conversion, not a second way in

The last step turns an accepted offer into a member of staff, and it goes
through **exactly the same onboarding** described in the next section. It is
the same code path: the employee code, the login that cannot be signed into,
the onboarding record, and the single-use invite to their **personal** address
all happen the way they do for any other new starter.

The only thing anybody has to type is the **work email**, because a candidate
does not have one. The name comes off the candidate, the job and the start date
off the offer. Nothing is retyped, and there is one path into the company
rather than two that could drift apart.

Because it creates a login, hiring needs the invite permission as well as the
hiring one — and the system says so plainly rather than refusing for what looks
like the wrong reason.

**A hiring manager sees their own openings and nobody else's.** They can give
interview feedback on the people they meet. They cannot make the offer, and
they cannot do the hire.

## A new person joins

HR creates the employee record: name, contact details, join date, which
department and location, which shift, and who they report to.

A few things happen automatically:

- They get an **employee code** (like `EMP-0007`), taking the next free number.
- If they are given a login, it is created **at the same moment** as the
  employee record — the system will never end up with one and not the other.

### Two ways in, and the difference matters

HR chooses between **Add employee** and **Onboard**, and they hand over the
first password very differently.

**Add employee** is for somebody who already works here — backfilling the
existing team. Their login starts on a shared default password and they must
change it the first time they sign in. This only works if **somebody tells them
that password**, so it suits a room where HR can say it out loud.

**Onboard** is for somebody joining. No password is ever created — the account
is deliberately given one nobody can reproduce, and it cannot be signed into at
all. Instead the hire gets an email at their **personal** address, because the
work mailbox usually does not exist on their first day. The link is single-use,
and re-sending an invitation kills the previous one so only ever one link works.

They then fill in their own details, bank account and documents, and HR reviews
the submission before the account becomes usable. Until it is approved they can
reach the onboarding form and nothing else — not attendance, not the directory.

If the invitation email fails to send, the hire is still created and the
invitation can be resent. Losing the record because a mail server was down would
be the worse outcome.

The system refuses to create a **circular reporting line** — you cannot make
someone their own manager, directly or through a chain. Without that check an
approval could have nowhere to go.

**A photo is optional and self-service.** Anybody can put one on their own
record from My profile, and HR can set or remove one from the employee record.
Without a photo the system shows initials, which is what almost everybody
starts as. The picture is squared and shrunk inside your browser before it is
sent, so a 4 MB phone photo arrives as about 40 KB — and it is served through
the system rather than from a public address, so a photo is no more visible to
the outside world than the rest of the record.

**Bank details** are treated as more sensitive than the rest of the record. The
employee can see their own, and HR can see them; a direct manager cannot.

**When someone leaves**, their record is not erased — see
[Somebody leaves](#somebody-leaves) below.

### Probation, and being confirmed

New hires normally start on probation. The company sets a default length (three
months out of the box) and any individual can be given their own. Nobody is put
on probation retrospectively: employees who were already here when this was
switched on are treated as confirmed, because they are.

Probation is worked out from dates on the record rather than being a status of
its own. That sounds like a technicality and is not: it means somebody on
probation is a perfectly ordinary employee everywhere else in the system. They
appear in the directory, book leave, and are paid, exactly as anyone else. The
only thing probation changes is that HR sees them on a **Probation ending** list
as their date approaches.

At the end of it, one of two things happens:

- If the company has **automatic confirmation** on, they are confirmed the day
  the date passes.
- If not, they sit on that list until HR presses **Confirm** — which is the
  right default for a company that wants a conversation first.

HR can also **extend** probation, with a reason and a new date. Every
confirmation and extension is recorded, so the employment history reads as a
sequence somebody can follow rather than a single current value.

---

## The dashboard

The landing page, and it is meant to answer one question: **is anything waiting
on me?**

What each person sees depends on what they may do. An employee gets their clock
card and three figures about themselves — how much leave they have left this
year, how many of their own requests are still waiting on a decision, and how
many days they have been in this month — plus announcements, the holiday
calendar and celebrations. A manager also gets what is waiting on them to
approve, who is in today, who is remote, who is late, and who is leaving. HR
sees the headcount; finance sees payroll that is stuck.

A manager does not get the personal three on top of all that. Their row is
already a list of things waiting on them, and their own leave balance is not the
most urgent item on it — it is one click away on the leave screen. The personal
tiles fill the row for people who have no such list, which until now meant an
employee arrived at no tiles at all.

Nothing is shown that the person cannot act on. Counts of departments and
offices used to sit here and were removed — they change a few times a year and
nobody ever did anything about them.

**Celebrations** lists birthdays and work anniversaries in the next 30 days, and
everyone can see it, because the point is that colleagues wish each other well.
A birthday shows the day and the month and never an age — the system does not
send the year at all, so there is nothing to work it out from. Work
anniversaries do show the number of years, since that is the whole point of one.

---

## Every working day: attendance

People clock in when they start and clock out when they stop — as many times a
day as they need to. Lunch, a client visit, an evening stint: each is its own
session, and the day adds them up. Clocking out is never the end of the day, so
doing it by accident costs nothing; clocking straight back in within a couple of
minutes simply resumes the session, leaving no trace of the mistake.

Tapping clock-in twice without leaving does nothing the second time, so a double
tap still can't create a mess.

Nobody is asked where they are working. The position answers it: a punch inside
one of the places you have put on the map is an office day — or a client-site
day, if that is what the place is — and a punch anywhere else is a remote one.
Location is required, and it is read at the moment of each punch, never in
between.

What the system is *sure* of is recorded alongside. A position comes with an
accuracy, which is a radius of uncertainty rather than a margin of error, and
wifi positioning is routinely a kilometre out. So a reading only counts as
confirmed when that whole circle of uncertainty sits clearly on one side of the
boundary. When it straddles the fence, the nearest reading is recorded and
marked as **not confirmed** — an honest "we could not tell", never an
accusation, and never a reason to stop somebody working.

Two other things read as not confirmed: a browser that cannot supply a position
at all, and an organization that has not yet put any place on the map. Both take
the answer that penalises nobody — an office day — and say plainly that it was
a guess. A refused permission is different: that *is* something the person can
undo, so the punch waits until they do.

A day away from the office keeps no coordinates. They have to be measured to
work out the answer, but once the answer is "remote" the position is discarded
rather than stored: it would be somebody's home, and the answer is all the
business needs.

A day worked entirely away from the office is recorded as **work from home**;
mix a remote morning with an afternoon in the office and it is simply a present
day.

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

## Working from home

Attendance already knows **who** worked from home: when somebody clocks in, the
system checks their position against the office geofences, and a day worked
entirely away from every office is recorded as work-from-home. Nobody types
that in — it is measured.

What this part adds is **who was allowed to**. An employee asks for a range of
days with a reason; their manager agrees or declines. Weekends and holidays in
the range are skipped, so asking for a whole week books the working days in it
and nothing else.

There is a **weekly limit** — two days out of the box. A company sets its own,
and an individual can be given a different one on their record: a fully-remote
hire and somebody who is never off site are both ordinary arrangements. Zero
means never; seven means every day, which is how a company with no limit says
so. Asking for more than the limit is refused, and the refusal names the week
and the count rather than saying "over your limit".

The check counts days already booked, not just the ones being asked for. Asking
for a Wednesday when Tuesday and Thursday are already agreed is over a limit of
two, and it is refused then rather than at the end of the month.

### Nothing is blocked at the door

**A day worked from home without an approved request is still recorded.** It
shows on the calendar as work-from-home, exactly as an agreed day does, and is
marked as *unplanned*.

That is deliberate, and it is the most important thing in this section. A burst
pipe at seven in the morning is not a policy violation the software should be
adjudicating, and refusing the clock-in would not stop somebody working — it
would only lose the record that they did. The company gets a truthful
attendance record and a visible list of the days nobody planned, which is what
somebody having the conversation actually needs.

A manager sees the flag on their team's day view; the employee sees it on their
own month.

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

## Somebody leaves

Leaving has three parts, and they are deliberately separate: the **resignation**
is the request and the decision, the **exit** is the work, and the
**settlement** is the money.

### The resignation

An employee files it themselves: a reason, the date they would like to finish,
and a note. The system works out the earliest date their notice period allows
and says so on the form — so somebody asking to leave sooner is doing it
knowingly rather than by accident. They can still ask; it just goes to whoever
approves it as a request for a shorter notice.

It goes to their **manager first**, then to **HR**, unless the company has
turned manager approval off — or the person has no manager, in which case there
would be nobody to review it and it goes straight to HR. Either desk can
approve, reject, or **ask for changes**, which hands it back to the employee to
edit and resubmit. Every step takes remarks, and every step is recorded.

HR can approve a request still sitting on the manager's desk. That is a real
decision rather than an oversight — sometimes the manager is the problem — and
when it happens the history says the manager's step was skipped rather than
quietly recording HR's approval as theirs.

Until it is approved, the employee can **withdraw** it. After approval they
cannot, because an exit is by then underway.

### The exit

Approving a resignation opens an **exit record** automatically. HR can also open
one directly for a termination, a contract ending, a retirement — the work is
identical whichever way it started, which is why there is one list rather than
two.

The exit freezes the person's department, job title and manager **as they were
on the day it started**. Six months later the department may have been merged
away and the manager may have left themselves; a record that reads "—" for both
is no use to whoever is answering a reference request.

Each exit carries a **clearance checklist**, copied from a template the company
edits in Settings. Each item names who signs it off — the manager, HR, finance,
or IT — and each can be cleared, or **waived with a reason**. A contractor with
no company laptop is closed honestly rather than by ticking a box that says the
laptop came back. An exit cannot be completed while a required item is still
outstanding, and the refusal names which ones.

**"Return company assets" is the one item nobody signs.** It reads the asset
register: it lists what the leaver is still holding, by asset tag, and settles
itself when the last thing comes back. Ticking it by hand is refused, because
that would be asserting the laptops came back while the register says they did
not. It can still be waived with a reason — "they posted it back" and "written
off" are real answers.

Companies that were already using the system keep signing that item by hand
until they switch it on in Settings. Turning a completion gate on underneath an
exit already in progress could block somebody with no way out, so it is a
deliberate choice rather than something that happened to them.

HR can also record an **exit interview**: the questions, the answers, and
whether the company would rehire the person. Only HR can read it — deliberately
not the leaver's own manager, who is very often the subject of the answers.

When the exit completes, the person's status becomes *exited*, their sign-in is
disabled and every device they are signed in on is signed out immediately. Their
record is not erased: old payslips and attendance still exist, because deleting
them would corrupt last year's accounts.

If the last working day passes and nobody has closed the exit, the system closes
it — but only if the company has asked it to. Off means somebody who has left
keeps working access until HR completes the exit by hand, which some companies
want and should be their choice rather than the software's.

An exit can be **cancelled**: they are staying after all. That restores their
sign-in and reopens the resignation behind it.

### The settlement

What the company owes them, as one document. It is prepared on demand rather
than the moment the exit starts — a settlement computed the day notice begins is
priced off a leave balance with two months left to move.

Three figures are worked out, and each prints the arithmetic underneath it,
because a number nobody can check is a number nobody accepts:

- **Leave encashment** — whatever is left of any leave type the company has
  marked as encashable, at a day's pay each. Most leave is use-it-or-lose-it, so
  nothing is encashable until somebody says it is.
- **Notice recovery** — pay for notice they did not serve. **Only for a
  resignation.** When the company ends the employment, the company owes notice
  rather than collecting it, and nothing is recovered.
- **Gratuity** — for people past a qualifying period, at the statutory rate and
  under the statutory ceiling. Every one of those numbers is a setting, because
  the law's figures have moved before.

Every figure can be changed, and anything else added by hand — a retention
bonus, tax withheld, an asset nobody returned. A real settlement is negotiated,
and a system that computes an unarguable number is a system people work around
in a spreadsheet. A figure somebody changed says so on the statement rather than
being presented as the system's own.

**HR prepares it; finance approves and pays it.** They are separate permissions
and the same separation payroll already runs on. Once approved, nothing can be
edited — the approval on record has to be an approval of the figures somebody
can still see. Recording the payment needs a bank reference, because "paid" with
nothing to check it against is a claim rather than a record.

If the recovery comes to more than what is owed, the total is a **balance due
back** rather than a payment out, and the statement says so in those words.

The statement is a **printable document handed over**, not a screen the leaver
logs in to read — by the time it is ready their sign-in has been suspended. That
is also why it prints its own workings and stands alone on paper.

**Completing the exit is not blocked on the settlement.** Settlement routinely
lands weeks after the last working day, and blocking would mean somebody's
access stays open until finance pays. A company that wants the two coupled can
add a finance-owned "clear outstanding dues" item to the clearance checklist,
which is on the default list already.

Tax is not withheld on a settlement. The system does not project tax anywhere —
monthly TDS is entered per employee, not computed — and a settlement is not
where a tax engine should first appear. HR adds a deduction line for it.

---

## Company property: assets

A register of the things the company owns and who is holding each one.

**One row per physical thing**, not a count per kind. There is a row for *that*
laptop — its asset tag, serial number, make and model, what it cost, when the
warranty runs out — rather than a line saying the company owns twelve. That is
what lets somebody be asked to return a specific item, and what lets an exit be
blocked on it.

IT **issues** an asset to somebody and **takes it back** later, recording the
condition each way. "It came back scratched" is then a fact on the record rather
than an argument six months on. Returned rows stay, so the register can still
answer who had a laptop in March.

An asset can be in one person's hands at a time, and the database enforces that
rather than trusting the software to remember. It can also be marked **in
repair**, **lost** or **retired**, each with a reason:

- **In repair** and **retired** are refused while somebody is still holding it.
  Both mean the company has the thing back, and it does not.
- **Lost** is allowed, because "it is gone" is exactly the case where it cannot
  be handed back first. Writing one off closes that person's assignment.
- **Retired is final.** A replacement is a new row with its own tag and its own
  history, not the old one brought back to life.

An asset that has ever been issued **cannot be deleted** — the row is the answer
to "who had this", which is what the register is for. Retiring is the honest way
to stop using something.

Everyone can see **what is issued to them**, on their profile. They cannot edit
it: the register is IT's record, and somebody who cannot see their own list
cannot return it — which matters most on the way out.

Assets are what make the exit checklist's "return company assets" line mean
something; see [Somebody leaves](#somebody-leaves) above.

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
- **Work from home** — whether people may ask at all, how many remote days a
  week they get, and whether a manager has to agree first.
- **Employment lifecycle** — the default notice period and probation length,
  whether confirmation and exits happen automatically, and whether resignations
  go past the manager. Every number here is a default an individual employee can
  override.
- **Exit checklist** — the clearance template each exit is copied from. Editing
  it changes what future exits carry, never one already underway.
  One item per checklist can be marked **read from the asset register**, which
  is what makes "return company assets" compute itself.
- **Full & final settlement** — what a day of pay is worth and whether it is
  priced off basic or gross, whether short notice is recovered, and the gratuity
  rate, qualifying period and ceiling.
- **Modules** — which sections appear in the menu.

One warning about that last one: **hiding a module only hides the menu entry.**
It does not remove anyone's access. If you need someone not to see payroll,
change their role — do not rely on the menu toggle.

---

## Things the system does not do yet

Being straight about this is more useful than a feature list:

- **Email only reaches one address until a domain is verified.** Mail is
  connected — password resets and onboarding invites are really sent, through
  Resend. But the default sender is Resend's sandbox address, and it delivers
  only to the address that owns the Resend account. Everyone else gets nothing,
  and the send is refused rather than lost silently. Verifying a domain and
  pointing `MAIL_FROM` at it is what makes mail work for real people.
- **Only two emails have senders.** Settings lists four editable templates, but
  `leave_approved` and `leave_rejected` are never sent by anything — the screen
  marks them so. Approving leave notifies nobody.
- **Payslips cannot be downloaded as PDFs** — data exports are spreadsheets.
  Payslips and settlement statements print from the browser instead, which
  produces a perfectly good file and keeps the document inspectable.
- **Nothing is emailed when a resignation moves.** Approvals, clearance
  sign-offs and settlement approvals all raise an in-app notification and
  nothing else, so somebody who does not open the app does not hear about it.
- **Tax is not computed on a settlement**, or projected anywhere else. Monthly
  TDS is entered per employee, and settlement tax is a line HR adds by hand.
- **The asset register does not do depreciation, purchasing or vendors.** It
  records what exists and who has it. What a laptop is worth after three years
  is an accounting question this does not answer.
- **Nobody signs for an asset.** IT records what was handed over; the employee
  can read the list but does not confirm it. In a dispute the record is one
  side's, not both.
- **There is no public careers page.** Recruitment is internal only: HR adds a
  candidate, or puts a referral forward. Nobody can apply from outside, and
  nothing accepts a CV upload from a stranger yet — that is the one part of the
  product that would take writes from the public, and it deserves its own
  change rather than the tail end of this one.
- **Interviews are not on anybody's calendar.** An interview carries a time and
  an interviewer, and the system tells nobody. Sending the invite, and syncing
  with Google or Outlook, is an integration that does not exist.
- **There is no offer letter.** The offer holds the agreed terms; producing the
  document is still a manual job, even though the letters module already issues
  documents from templates.
- **There is no mobile app**, and one is no longer planned — it has been dropped
  from the roadmap rather than deferred. The web app is responsive, and the
  header-token auth variant in
  [07-auth-architecture.md](./07-auth-architecture.md) stays described because
  it is what the refresh-token design already allows, not because something is
  scheduled to use it.
- **Companies cannot sign themselves up.** A new company has to be created on
  the server (see [14-production-setup.md](./14-production-setup.md)).
