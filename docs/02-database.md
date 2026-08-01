# 2–4 — Database Schema, Prisma Models, ER Diagram

PostgreSQL 16 · Prisma ORM · all timestamps UTC (`timestamptz`) · IDs are `cuid()` strings · money/hours stored as integers (minutes, cents) to avoid float drift.

## Schema principles

1. **Tenant scoping:** every tenant-owned table has `organizationId` + composite indexes starting with it (ADR §1.3).
2. **`User` ≠ `Employee`:** `User` is a login (auth concern); `Employee` is an HR record (domain concern). An employee can exist before being invited to log in; a user (e.g. external auditor) can exist without an employee record. 1↔0..1 relation.
3. **Soft delete only where the domain requires history:** `Employee`, `Document` (`deletedAt`). Everything else hard-deletes; `AuditLog` keeps the trail.
4. **Approvals are uniform:** `LeaveRequest` and `AttendanceRequest` share the same status machine `PENDING → APPROVED | REJECTED | CANCELLED`, same approver fields — so a generic approvals inbox is possible later.
5. **Enums live in Prisma** (DB-level) and are re-exported through `packages/types` so web and api share them.

## ER Diagram

```mermaid
erDiagram
    Organization ||--o{ Department : has
    Organization ||--o{ Location : has
    Organization ||--o{ Designation : has
    Organization ||--o{ Holiday : has
    Organization ||--o{ Employee : employs
    Organization ||--o{ User : owns
    Organization ||--o{ Setting : configures

    User ||--o| Employee : "is linked to"
    User }o--|| Role : "has"
    Role }o--o{ Permission : "grants (RolePermission)"
    User ||--o{ RefreshSession : "signs in via"

    Department ||--o{ Employee : contains
    Department |o--o| Department : "parent of"
    Designation ||--o{ Employee : titles
    Location ||--o{ Employee : "based at"
    Employee |o--o{ Employee : "manages (reportsTo)"
    Shift ||--o{ Employee : "assigned to"

    Employee ||--o{ AttendanceRecord : logs
    Employee ||--o{ AttendanceRequest : raises
    Employee ||--o{ LeaveRequest : submits
    Employee ||--o{ LeaveBalance : holds
    LeaveType ||--o{ LeaveRequest : "typed as"
    LeaveType ||--o{ LeaveBalance : "typed as"

    Employee |o--o{ Document : "subject of"
    DocumentCategory ||--o{ Document : groups
    User ||--o{ Document : uploads

    Organization ||--o{ PayComponent : "catalogues"
    Organization ||--o{ SalaryStructure : defines
    Organization ||--o{ PayrollRun : runs
    SalaryStructure ||--o{ StructureLine : "composed of"
    PayComponent ||--o{ StructureLine : "typed as"
    SalaryStructure ||--o{ EmployeeSalary : "assigned by"
    Employee ||--o{ EmployeeSalary : "earns (effective-dated)"
    PayrollRun ||--o{ Payslip : produces
    Employee ||--o{ Payslip : "paid by"
    Payslip ||--o{ PayslipLine : "broken down into"

    User ||--o{ Announcement : authors
    Announcement ||--o{ AnnouncementRead : "read by"
    User ||--o{ AnnouncementRead : reads
    User ||--o{ Notification : receives
    User ||--o{ AuditLog : performs
```

## Prisma models

The schema below is applied — `apps/api/prisma/schema.prisma` is the source of
truth and this is its narrative form.

```prisma
// ─── Identity & Access ────────────────────────────────────────────────

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  timezone  String   @default("UTC")
  logoUrl   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users        User[]
  employees    Employee[]
  departments  Department[]
  designations Designation[]
  locations    Location[]
  holidays     Holiday[]
  settings     Setting[]
}

model User {
  id             String     @id @default(cuid())
  organizationId String
  email          String     @unique
  passwordHash   String                    // Argon2id
  status         UserStatus @default(INVITED)
  roleId         String
  lastLoginAt    DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  organization Organization  @relation(fields: [organizationId], references: [id])
  role         Role          @relation(fields: [roleId], references: [id])
  employee     Employee?
  sessions     RefreshSession[]

  @@index([organizationId])
}

enum UserStatus { INVITED ACTIVE SUSPENDED }

model Role {
  id          String  @id @default(cuid())
  code        String  @unique            // ADMIN, HR, MANAGER, EMPLOYEE (seeded)
  name        String
  description String?
  isSystem    Boolean @default(false)    // system roles are not deletable

  users       User[]
  permissions RolePermission[]
}

model Permission {
  id       String @id @default(cuid())
  code     String @unique               // "<resource>.<action>", e.g. "leave.approve"
  resource String
  action   String

  roles RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@id([roleId, permissionId])
}

model RefreshSession {
  id           String    @id @default(cuid())
  userId       String
  tokenHash    String    @unique         // SHA-256 of the opaque refresh token
  userAgent    String?
  ip           String?
  expiresAt    DateTime
  revokedAt    DateTime?
  replacedById String?                   // rotation chain → reuse detection (doc 07)
  createdAt    DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique          // the raw token is never stored
  expiresAt DateTime
  usedAt    DateTime?                  // single-use: a replay is a no-op
  createdAt DateTime  @default(now())

  @@index([userId])
}

// ─── Organization ─────────────────────────────────────────────────────

model Department {
  id             String  @id @default(cuid())
  organizationId String
  name           String
  code           String?
  parentId       String?
  headId         String?  @unique        // Employee who leads this department

  organization Organization @relation(fields: [organizationId], references: [id])
  parent       Department?  @relation("DeptTree", fields: [parentId], references: [id])
  children     Department[] @relation("DeptTree")
  head         Employee?    @relation("DeptHead", fields: [headId], references: [id])
  employees    Employee[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

model Designation {
  id             String @id @default(cuid())
  organizationId String
  title          String
  level          Int    @default(0)      // for org-chart & report grouping

  organization Organization @relation(fields: [organizationId], references: [id])
  employees    Employee[]

  @@unique([organizationId, title])
}

model Location {
  id             String  @id @default(cuid())
  organizationId String
  name           String
  address        String?
  city           String?
  country        String?
  timezone       String?                 // overrides org default (ADR A7)

  organization Organization @relation(fields: [organizationId], references: [id])
  employees    Employee[]
  holidays     Holiday[]

  @@unique([organizationId, name])
}

model EmploymentType {                 // Full-time, Contract, Intern…
  id             String  @id @default(cuid())
  organizationId String
  name           String
  code           String?

  @@unique([organizationId, name])
}

model Holiday {
  id             String   @id @default(cuid())
  organizationId String
  locationId     String?                 // null = org-wide
  name           String
  date           DateTime @db.Date
  isOptional     Boolean  @default(false)

  organization Organization @relation(fields: [organizationId], references: [id])
  location     Location?    @relation(fields: [locationId], references: [id])

  @@unique([organizationId, locationId, date, name])
  @@index([organizationId, date])
}

// ─── Employees ────────────────────────────────────────────────────────

model Employee {
  id             String         @id @default(cuid())
  organizationId String
  userId         String?        @unique
  employeeCode   String                        // e.g. EMP-0001
  firstName      String
  lastName       String
  workEmail      String
  personalEmail  String?
  phone          String?
  dateOfBirth    DateTime?      @db.Date
  gender         Gender?
  avatarUrl      String?
  addressLine    String?
  city           String?
  country        String?
  departmentId   String?
  designationId  String?
  locationId     String?
  managerId      String?                        // reportsTo
  shiftId        String?
  employmentType EmploymentType @default(FULL_TIME)
  status         EmployeeStatus @default(ACTIVE)
  joinDate       DateTime       @db.Date
  exitDate       DateTime?      @db.Date
  deletedAt      DateTime?                      // soft delete (schema principle 3)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  organization Organization  @relation(fields: [organizationId], references: [id])
  user         User?         @relation(fields: [userId], references: [id])
  department   Department?   @relation(fields: [departmentId], references: [id])
  designation  Designation?  @relation(fields: [designationId], references: [id])
  location     Location?     @relation(fields: [locationId], references: [id])
  manager      Employee?     @relation("ReportsTo", fields: [managerId], references: [id])
  reports      Employee[]    @relation("ReportsTo")
  shift        Shift?        @relation(fields: [shiftId], references: [id])
  headOf       Department?   @relation("DeptHead")

  emergencyContacts EmergencyContact[]
  attendance        AttendanceRecord[]
  attendanceRequests AttendanceRequest[]
  leaveRequests     LeaveRequest[]
  leaveBalances     LeaveBalance[]
  documents         Document[]

  @@unique([organizationId, employeeCode])
  @@index([organizationId, status])
  @@index([organizationId, departmentId])
  @@index([managerId])
}

enum Gender { MALE FEMALE OTHER PREFER_NOT_TO_SAY }
enum EmploymentType { FULL_TIME PART_TIME CONTRACT INTERN }
enum EmployeeStatus { ACTIVE ON_NOTICE EXITED }

model BankDetail {                     // 1-1 with Employee; payroll's payment target
  id                String   @id @default(cuid())
  employeeId        String   @unique
  accountHolderName String
  bankName          String
  accountNumber     String                // masked before it reaches a payslip
  ifscCode          String?
  branch            String?
  updatedAt         DateTime @updatedAt
}

model EmergencyContact {
  id         String @id @default(cuid())
  employeeId String
  name       String
  relation   String
  phone      String

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
}

// ─── Attendance ───────────────────────────────────────────────────────

model Shift {
  id             String @id @default(cuid())
  organizationId String
  name           String
  startTime      String                 // "09:00" — local to employee's location TZ
  endTime        String                 // "18:00"
  graceMinutes   Int    @default(15)

  employees Employee[]

  @@unique([organizationId, name])
}

model AttendanceRecord {
  id           String           @id @default(cuid())
  organizationId String
  employeeId   String
  date         DateTime         @db.Date
  checkIn      DateTime?
  checkOut     DateTime?
  workMinutes  Int?                     // computed at checkout / by nightly job
  status       AttendanceStatus @default(PRESENT)
  source       AttendanceSource @default(WEB)
  note         String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  employee Employee @relation(fields: [employeeId], references: [id])

  @@unique([employeeId, date])
  @@index([organizationId, date])
}

enum AttendanceStatus { PRESENT ABSENT HALF_DAY ON_LEAVE HOLIDAY WEEK_OFF WFH }
enum AttendanceSource { WEB MOBILE ADMIN IMPORT }   // MOBILE/biometric arrive later as new sources

model AttendanceRequest {
  id          String        @id @default(cuid())
  employeeId  String
  date        DateTime      @db.Date
  requestedIn DateTime?
  requestedOut DateTime?
  reason      String
  status      ApprovalStatus @default(PENDING)
  approverId  String?                   // User id
  actedAt     DateTime?
  approverNote String?
  createdAt   DateTime      @default(now())

  employee Employee @relation(fields: [employeeId], references: [id])

  @@index([employeeId, status])
}

enum ApprovalStatus { PENDING APPROVED REJECTED CANCELLED }

// ─── Leave ────────────────────────────────────────────────────────────

model LeaveType {
  id             String  @id @default(cuid())
  organizationId String
  name           String                 // Casual, Sick, Earned…
  code           String
  daysPerYear    Decimal @db.Decimal(5, 1)
  isPaid         Boolean @default(true)
  carryForward   Boolean @default(false)
  maxCarryForward Decimal? @db.Decimal(5, 1)
  requiresApproval Boolean @default(true)

  requests LeaveRequest[]
  balances LeaveBalance[]

  @@unique([organizationId, code])
}

model LeaveBalance {
  id          String  @id @default(cuid())
  employeeId  String
  leaveTypeId String
  year        Int
  allocated   Decimal @db.Decimal(5, 1)
  used        Decimal @db.Decimal(5, 1) @default(0)
  carriedOver Decimal @db.Decimal(5, 1) @default(0)

  employee  Employee  @relation(fields: [employeeId], references: [id])
  leaveType LeaveType @relation(fields: [leaveTypeId], references: [id])

  @@unique([employeeId, leaveTypeId, year])
}

model LeaveRequest {
  id          String         @id @default(cuid())
  employeeId  String
  leaveTypeId String
  startDate   DateTime       @db.Date
  endDate     DateTime       @db.Date
  halfDaySide HalfDaySide?               // null = full days
  days        Decimal        @db.Decimal(5, 1)
  reason      String
  status      ApprovalStatus @default(PENDING)
  approverId  String?
  actedAt     DateTime?
  approverNote String?
  createdAt   DateTime       @default(now())

  employee  Employee  @relation(fields: [employeeId], references: [id])
  leaveType LeaveType @relation(fields: [leaveTypeId], references: [id])

  @@index([employeeId, status])
  @@index([status, startDate])
}

enum HalfDaySide { FIRST_HALF SECOND_HALF }

// ─── Documents ────────────────────────────────────────────────────────

model DocumentCategory {
  id             String @id @default(cuid())
  organizationId String
  name           String                 // Policies, Contracts, Payslips…

  documents Document[]

  @@unique([organizationId, name])
}

model Document {
  id             String    @id @default(cuid())
  organizationId String
  employeeId     String?                 // null = company document
  categoryId     String?
  name           String
  fileKey        String                  // storage key (S3/MinIO) — never a raw URL
  mimeType       String
  sizeBytes      Int
  visibility     DocVisibility @default(PRIVATE)
  uploadedById   String                  // User id
  deletedAt      DateTime?
  createdAt      DateTime  @default(now())

  employee Employee?         @relation(fields: [employeeId], references: [id])
  category DocumentCategory? @relation(fields: [categoryId], references: [id])

  @@index([organizationId, employeeId])
}

enum DocVisibility { PRIVATE ORG }      // PRIVATE = employee + HR/Admin; ORG = everyone

// ─── Announcements & Notifications ────────────────────────────────────

model Announcement {
  id             String   @id @default(cuid())
  organizationId String
  title          String
  body           String                  // markdown
  audience       Audience @default(ALL)
  departmentId   String?                 // when audience = DEPARTMENT
  locationId     String?                 // when audience = LOCATION
  isPinned       Boolean  @default(false)
  publishAt      DateTime @default(now())
  expiresAt      DateTime?
  authorId       String                  // User id
  createdAt      DateTime @default(now())

  reads AnnouncementRead[]

  @@index([organizationId, publishAt])
}

enum Audience { ALL DEPARTMENT LOCATION }

model AnnouncementAttachment {
  id             String   @id @default(cuid())
  announcementId String
  name           String
  fileKey        String                  // storage key, never a public URL
  mimeType       String
  sizeBytes      Int
  createdAt      DateTime @default(now())

  @@index([announcementId])
}

model AnnouncementRead {
  announcementId String
  userId         String
  readAt         DateTime @default(now())

  announcement Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)

  @@id([announcementId, userId])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  type      String                      // "leave.approved", "attendance.rejected"…
  title     String
  body      String?
  linkPath  String?                     // in-app deep link
  readAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, readAt])
}

// ─── Payroll ──────────────────────────────────────────────────────────
// Money is Decimal(14,2) throughout. See "Notable design calls" below for
// why payslips snapshot rather than join.

enum PayComponentKind { EARNING  DEDUCTION  EMPLOYER_CONTRIBUTION }
enum SalaryCalcType   { FLAT  PERCENT_OF_BASIC  PERCENT_OF_CTC  STATUTORY  BALANCE }
enum SalaryRevisionType { JOINING  INCREMENT  PROMOTION  TRANSFER  ADJUSTMENT }
enum PaymentMethod    { BANK_TRANSFER  CASH  CHEQUE }
enum PayrollRunStatus { DRAFT  IN_REVIEW  APPROVED  LOCKED  PUBLISHED  CANCELLED }
enum PayslipPaymentStatus { PENDING  PROCESSING  PAID  FAILED  CANCELLED }

model PayComponent {                    // Org catalogue of payslip line types
  id             String @id @default(cuid())
  organizationId String
  code           String                 // BASIC, HRA, PF, ESI, PT, TDS…
  name           String
  kind           PayComponentKind
  taxable        Boolean @default(true)
  isStatutory    Boolean @default(false)  // filled by the statutory engine
  isSystem       Boolean @default(false)  // seeded, undeletable — looked up by code
  order          Int     @default(0)
  active         Boolean @default(true)

  @@unique([organizationId, code])
}

model SalaryStructure {
  id             String  @id @default(cuid())
  organizationId String
  name           String
  code           String
  description    String?
  isActive       Boolean @default(true)

  lines       StructureLine[]
  assignments EmployeeSalary[]

  @@unique([organizationId, code])
}

model StructureLine {
  id          String         @id @default(cuid())
  structureId String
  componentId String
  calcType    SalaryCalcType
  value       Decimal        @default(0) @db.Decimal(14, 2)
  order       Int            @default(0)

  @@unique([structureId, componentId])   // a component appears once per structure
}

// Effective-dated: this table *is* the revision history.
model EmployeeSalary {
  id            String             @id @default(cuid())
  employeeId    String
  structureId   String
  effectiveFrom DateTime           @db.Date
  monthlyCtc    Decimal            @db.Decimal(14, 2)
  monthlyTds    Decimal            @default(0) @db.Decimal(14, 2)  // entered, not projected
  revisionType  SalaryRevisionType @default(JOINING)
  reason        String?
  paymentMethod PaymentMethod      @default(BANK_TRANSFER)
  approvedById  String?

  @@unique([employeeId, effectiveFrom])
}

model PayrollRun {
  id             String           @id @default(cuid())
  organizationId String
  month          String                       // "YYYY-MM"
  status         PayrollRunStatus @default(DRAFT)
  payDate        DateTime?        @db.Date
  // Who did what, when — the approval trail
  calculatedAt   DateTime?  calculatedById String?
  approvedAt     DateTime?  approvedById   String?
  lockedAt       DateTime?  lockedById     String?
  publishedAt    DateTime?  publishedById  String?
  // Denormalised for the list view; asserted against the payslips in tests
  employeeCount     Int     @default(0)
  totalEarnings     Decimal @default(0) @db.Decimal(14, 2)
  totalDeductions   Decimal @default(0) @db.Decimal(14, 2)
  totalEmployerCost Decimal @default(0) @db.Decimal(14, 2)
  netPayable        Decimal @default(0) @db.Decimal(14, 2)

  payslips Payslip[]

  @@unique([organizationId, month])            // one run per month
}

model Payslip {
  id             String @id @default(cuid())
  organizationId String
  runId          String
  employeeId     String

  // Snapshot — deliberately duplicated, never joined (see design calls)
  employeeCode        String
  employeeName        String
  departmentName      String?
  designationName     String?
  structureName       String
  bankName            String?
  accountNumberMasked String?           // "••••1234"
  ifsc                String?

  workingDays Decimal @db.Decimal(5, 2)
  lopDays     Decimal @default(0) @db.Decimal(5, 2)
  payableDays Decimal @db.Decimal(5, 2)

  grossEarnings        Decimal @db.Decimal(14, 2)
  totalDeductions      Decimal @db.Decimal(14, 2)
  employerContribution Decimal @default(0) @db.Decimal(14, 2)
  netPay               Decimal @db.Decimal(14, 2)
  carriedShortfall     Decimal @default(0) @db.Decimal(14, 2)  // never a negative salary

  paymentStatus PayslipPaymentStatus @default(PENDING)   // its own axis
  paymentMethod PaymentMethod        @default(BANK_TRANSFER)
  paidAt        DateTime?
  paymentRef    String?
  failureReason String?

  lines PayslipLine[]

  @@unique([runId, employeeId])
}

model PayslipLine {
  id            String           @id @default(cuid())
  payslipId     String
  componentCode String                  // snapshot, not an FK
  componentName String
  kind          PayComponentKind
  amount        Decimal          @db.Decimal(14, 2)
  order         Int              @default(0)
}

// ─── Settings & Audit ─────────────────────────────────────────────────

model Setting {
  organizationId String
  key            String                 // "workingWeek", "leave", "payroll", "modules"
  value          Json

  organization Organization @relation(fields: [organizationId], references: [id])

  @@id([organizationId, key])
}

// Per-org overrides of the built-in transactional emails. A template that
// fails to render falls back to the built-in one, so a bad edit can never
// stop a password reset from sending.
model EmailTemplate {
  organizationId String
  key            String                  // "password-reset", "invite"…
  subject        String
  bodyHtml       String
  isActive       Boolean  @default(true)
  updatedAt      DateTime @updatedAt

  @@id([organizationId, key])
}

model AuditLog {
  id        String   @id @default(cuid())
  organizationId String
  actorId   String?                     // User id; null = system
  action    String                      // "employee.update", "auth.login"…
  entity    String
  entityId  String?
  meta      Json?                       // diff / context
  ip        String?
  createdAt DateTime @default(now())

  @@index([organizationId, createdAt])
  @@index([entity, entityId])
}
```

## Notable design calls

- **`RefreshSession.replacedById`** implements rotation chains: presenting an already-rotated token revokes the whole chain (doc 07).
- **`AttendanceRecord @@unique([employeeId, date])`** makes "one row per employee per day" a DB invariant, not an application hope.
- **`LeaveBalance` is per-year** — year-end carry-forward is a job that writes next year's rows; history stays queryable for reports.
- **`Document.fileKey`** keeps storage private; downloads go through the API with a permission check and a short-lived signed URL.
- **Reports need no tables** — they are read-model queries over attendance/leave/employees, exported server-side (doc 03).

### Payroll

- **Money is `Decimal(14,2)` everywhere, never `Float`.** A rounding artefact in
  this module is somebody's salary.
- **`EmployeeSalary` is effective-dated, and *is* the revision history.** The
  salary as at a date is the row with the greatest `effectiveFrom` on or before
  it; the previous salary is the row before that. A separate history table is
  free to disagree with the live value, and eventually does.
  `@@unique([employeeId, effectiveFrom])` makes "one salary per person per
  effective date" a DB invariant.
- **`Payslip` carries a snapshot, not joins.** Employee name, code, department,
  designation, structure name and masked bank details are copied on at
  calculation. A payslip issued in March must still read correctly in December
  after a promotion, a transfer and a structure edit — so nothing on a
  processed payslip may be a live relation.
- **Account numbers are masked before they are stored on a payslip**
  (`••••1234`), so forwarding a payslip or emailing a report is not a leak.
- **`PayrollRun` denormalises its totals** for the list view, and they are
  asserted against the sum of its payslips in tests and by the seed.
- **Two status axes, deliberately.** `PayrollRun.status` is the workflow;
  `Payslip.paymentStatus` is the money. One employee's failed bank transfer
  must not reopen an approved run.
- **`carriedShortfall`** records deductions that could not be taken because
  they exceeded gross. Payroll never pays a negative salary; the remainder is
  carried and stays visible rather than being silently forgiven.
- **`PayComponent.isSystem`** marks the seeded catalogue undeletable — the
  calculation engine looks `BASIC`, `PF`, `ESI` and `PT` up by code.
- **Loss of pay is not a column.** It is derived at calculation from unpaid
  approved leave unioned with days marked absent, then frozen onto the payslip
  — the same derive-on-read rule attendance and leave already follow.
