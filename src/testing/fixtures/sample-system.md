# App: Leave Management

Scope: system
Owner: Platform
Status: sample

A worked example at **system scope**: several modules, two workflows that share the same
backend nodes, a role handover mid-workflow, and three error paths.

See [CONVENTION.md](./CONVENTION.md) for the full format.

## Module: Access

### Node: employee
Type: Actor
Name: Employee
Anyone who can submit a leave request for themselves.

### Node: admin
Type: Actor
Name: Leave administrator
Approves or rejects requests for their department.

## Module: Leave

### Node: apply-leave-page
Type: Page
Name: Apply Leave
Component: src/pages/leave/ApplyLeave.tsx
Description: Screen where an employee submits a new leave request.

### Node: leave-form
Type: Component
Name: LeaveRequestForm
Component: src/components/leave/LeaveRequestForm.tsx
Validates dates client-side before the request is allowed through.

### Node: post-leaves
Type: Endpoint
Name: POST /api/leaves
Method: POST
Path: /api/leaves
Auth: employee

### Node: patch-leave-approve
Type: Endpoint
Name: PATCH /api/leaves/:id/approve
Method: PATCH
Path: /api/leaves/:id/approve
Auth: admin

### Node: leave-controller
Type: Controller
Name: LeaveController
Source: src/controllers/leave.controller.ts

### Node: leave-service
Type: Service
Name: LeaveService
Source: src/services/leave.service.ts
Dependencies: notification-service, attendance-service
Owns entitlement arithmetic and the request state machine.

### Node: leave-request
Type: Table
Name: leave_requests
Key: id
Columns: employee_id, from_date, to_date, status, approver_id

### Node: leave-balance
Type: Table
Name: leave_balances
Columns: employee_id, year, entitled_days, taken_days

### Node: approve-leave-page
Type: Page
Name: Approvals
Component: src/pages/leave/Approvals.tsx

## Module: Notifications

### Node: notification-service
Type: Service
Name: NotificationService
Dependencies: email-provider

### Node: email-provider
Type: External
Name: Email provider
Vendor: SMTP relay

## Module: Attendance

### Node: attendance-service
Type: Service
Name: AttendanceService

### Node: attendance-record
Type: Table
Name: attendance_records

## Workflow: apply-leave

Name: Apply for leave
Roles: Employee
An employee submits a request; it is approved by an administrator, and approval writes
through to attendance.

Steps:
1. employee
2. apply-leave-page — opens the leave screen
3. leave-form — picks a date range
4. post-leaves — submits the request
5. leave-controller
6. leave-balance (read) — checks remaining entitlement
7. leave-service
8. leave-request (write) — stored as `pending`
9. notification-service — notifies the approver
10. admin (role: Admin) — request lands in the approval queue
11. approve-leave-page
12. patch-leave-approve (when: approver is in the same department)
13. attendance-service
14. attendance-record (write) — days marked as approved leave

Errors:
- at post-leaves -> validation-error: overlapping or missing dates
- at leave-service: insufficient leave balance for the requested period
- at email-provider: provider unreachable, notification is queued for retry

## Workflow: reject-leave

Name: Reject a leave request
Roles: Admin

Steps:
1. admin
2. approve-leave-page — reviews the pending queue
3. patch-leave-approve — submits a rejection with a reason
4. leave-controller
5. leave-service
6. leave-request (write) — status becomes `rejected`
7. notification-service — informs the employee

Errors:
- at patch-leave-approve: request was already approved by another administrator
