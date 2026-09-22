# App: HRMS — Leave management

Scope: feature
Repo: c:\Onee drive data\hrms
Stack: Express + Mongoose, React (CRA/craco)

The leave feature of the HRMS app, traced from the code rather than from names: an employee
applies, an administrator approves or rejects, and either party can cancel before the leave
starts. Approval writes through to leave balance and to attendance.

Every node carries the file it was read from. Anything not verified is in **Open questions**
at the bottom rather than guessed at.

## Module: Client

### Node: employee-leave-page
Type: Page
Name: Employee leave screen
Source: front/src/pages/employee/EmployeeLeave.jsx
Where an employee applies for leave and cancels a request.

### Node: admin-leave-page
Type: Page
Name: Leave & attendance admin screen
Source: front/src/pages/admin/LeaveAttendance.jsx
Lists pending requests and submits the approve/reject decision.

### Node: leave-client
Type: Function
Name: leaveService
Source: front/src/services/leaveService.js
Exports: submitLeaveRequest, adminApproveRejectLeave, cancelLeaveRequest

## Module: Leave API

### Node: post-leave-request
Type: Endpoint
Name: POST /api/leaves/leave-request
Method: POST
Path: /api/leaves/leave-request
Source: back/routes/leaves.routes.js:15
Upload: multer memoryStorage, single "document"

### Node: put-leave-approve
Type: Endpoint
Name: PUT /api/leaves/:id/approve
Method: PUT
Path: /api/leaves/:id/approve
Source: back/routes/leaves.routes.js:9

### Node: put-leave-cancel
Type: Endpoint
Name: PUT /api/leaves/:id/cancel
Method: PUT
Path: /api/leaves/:id/cancel
Source: back/routes/leaves.routes.js:16

### Node: auth-middleware
Type: Validation
Name: JWT auth guard
Source: back/middleware/auth.js
Verifies the bearer token, loads the User, sets req.user. Falls back to the refresh token
when the access token has expired. Shared by every leave route.

### Node: create-leave-request
Type: Controller
Name: createLeaveRequest
Source: back/controllers/leaves.controller.js:129

### Node: approve-reject-leave
Type: Controller
Name: approveOrRejectLeaveRequest
Source: back/controllers/leaves.controller.js:343

### Node: cancel-leave-request
Type: Controller
Name: cancelLeaveRequest
Source: back/controllers/leaves.controller.js:201

### Node: validate-leave-fields
Type: Validation
Name: Required fields present?
Source: back/controllers/leaves.controller.js:143
Checks: leave_id, leave_name, start_date, end_date, reason, days

### Node: has-entitlement
Type: Validation
Name: Employee entitled to this leave type?
Source: back/controllers/leaves.controller.js:411
Looks the leave type up in employee.leave_balance before deducting.

### Node: require-cancel-reason
Type: Validation
Name: Cancellation reason given?
Source: back/controllers/leaves.controller.js:207

### Node: cancellable-check
Type: Validation
Name: Leave still cancellable?
Source: back/controllers/leaves.controller.js:223
Rules: status is pending or approved, and the start date is not in the past.

### Node: leave-request-table
Type: Collection
Name: leaverequests
Model: back/models/LeaveRequest.js
Status: pending | approved | rejected | cancelled
Scoped by: company_id

### Node: employee-record
Type: Collection
Name: employees
Model: back/models/Employee.js
Holds leave_balance entries with total_allocated and used.

### Node: company-settings
Type: Collection
Name: companysettings
Model: back/models/CompanySettings.js
Holds leave_config, the list of leave types a request's leave_id points at.

## Module: Attendance

### Node: update-leave-schedule
Type: Function
Name: updateLeaveSchedule
Source: back/controllers/attendance.controller.js:1311
Walks every day between start and end and marks it in that month's attendance document.
Imported into the leave controller, which couples the two modules.

### Node: employee-attendance
Type: Collection
Name: employeeattendances
Model: back/models/EmployeeAttendance.js
One document per employee per month.

## Module: Notifications

### Node: notify-admins
Type: Function
Name: createAdminNotification
Source: back/utils/notification.js

### Node: notify-employee
Type: Function
Name: createNotification
Source: back/utils/notification.js

### Node: socket-broadcast
Type: Event
Name: new_notification
Source: back/controllers/leaves.controller.js:193
Transport: socket.io

### Node: notification-table
Type: Collection
Name: notifications
Model: back/models/Notification.js

## Module: Storage

### Node: upload-file-to-s3
Type: Function
Name: uploadFileToS3
Source: back/utils/s3Utils.js

### Node: s3-bucket
Type: External
Name: AWS S3
Key pattern: leave-documents/{company_id}/{timestamp}/{leave_id}.{ext}

## Module: Access

### Node: employee
Type: Actor
Name: Employee

### Node: admin
Type: Actor
Name: Leave administrator

## Workflow: apply-for-leave

Name: Apply for leave
Roles: Employee

Steps:
1. employee
2. employee-leave-page — fills in dates, type and reason
3. leave-client — submitLeaveRequest builds multipart FormData
4. post-leave-request
5. auth-middleware
6. create-leave-request
7. validate-leave-fields
8. upload-file-to-s3 (when: a supporting document was attached)
9. s3-bucket (write)
10. leave-request-table (write) — created with status pending
11. notify-admins
12. notification-table (write)
13. socket-broadcast — pushes the notification to connected admins

Errors:
- at validate-leave-fields: a required field is missing, 400
- at upload-file-to-s3: document upload to S3 failed, 500
- at socket-broadcast -> undefined-notification: emits an undeclared variable, so the call throws and the request returns 500 even though the leave was already saved

## Workflow: approve-or-reject-leave

Name: Approve or reject a leave request
Roles: Admin

Steps:
1. admin
2. admin-leave-page — reviews the pending queue
3. leave-client — adminApproveRejectLeave sends status and admin_comment
4. put-leave-approve
5. auth-middleware
6. approve-reject-leave
7. leave-request-table (read) — looked up by id and company_id
8. employee-record (read)
9. company-settings (read) — resolves leave_id against leave_config
10. leave-request-table (write) — status, approver and timestamp
11. has-entitlement (when: the decision is approve)
12. employee-record (write) — used days incremented, capped at total_allocated
13. update-leave-schedule
14. employee-attendance (write) — each day in range marked
15. notify-employee
16. notification-table (write)

Errors:
- at approve-reject-leave -> record-not-found: leave, employee or company settings missing, 404
- at has-entitlement: employee has no entitlement for this leave type, 400
- at update-leave-schedule -> attendance-written-on-reject: runs outside the approved-only branch, so a rejected request still rewrites attendance

## Workflow: cancel-leave

Name: Cancel a leave request
Roles: Employee

Steps:
1. employee
2. employee-leave-page — supplies a cancellation reason
3. leave-client — cancelLeaveRequest
4. put-leave-cancel
5. auth-middleware
6. cancel-leave-request
7. require-cancel-reason
8. leave-request-table (read) — scoped to this employee and company
9. cancellable-check
10. employee-record (write) — balance restored (when: the request had been approved)
11. leave-request-table (write) — status cancelled, with reason and timestamp

Errors:
- at require-cancel-reason: cancellation reason is empty, 400
- at cancellable-check: already cancelled or rejected, or the leave has already started, 400

## Open questions

- Cancelling an approved leave restores the leave balance but never calls
  `updateLeaveSchedule`, unlike approval. Attendance appears to keep showing the cancelled
  days as leave. Intentional, or missing?
- `POST /api/leaves/admin-leave-apply` (`createAndApproveLeaveRequest`, controller line 630)
  lets an admin apply and approve in one step. Not traced.
- The read paths — `adminLeaveDashboard`, `getEmployeeLeaveDashboard`,
  `fetchAllLeaveRequests`, `fetchEmployeeLeaveRequests` — are not covered here.
- `createLeaveRequest` never validates that `leave_id` exists in
  `CompanySettings.leave_config`; the approve path is the first place that resolves it. A
  request with an unknown leave type appears to be storable.
- `LeaveAttendance.jsx` calls `axios.get('/leaves')` and `axios.put('/leaves/:id/approve')`
  directly (lines 168 and 485) instead of going through `leaveService`, so there are two
  client paths to the same endpoints.
- `viewS3Document` / `generateSignedURL` (document download) not traced.
