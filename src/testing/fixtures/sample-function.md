# App: calculateLeaveBalance()

Scope: function
Source: src/services/leave/calculateLeaveBalance.ts

The same format at the smallest useful scope: **one standalone function**. No modules, a
handful of nodes, one workflow. The five layers still apply — inputs and outputs are the
`interface` layer, the function and its branches are `logic`, and anything it reads is
`data`.

### Node: caller
Type: Actor
Name: Calling code
LeaveService.submit() and the nightly accrual job.

### Node: params
Type: Input
Name: (employeeId, year)
Signature: (employeeId: string, year: number)

### Node: calculate-leave-balance
Type: Function
Name: calculateLeaveBalance
Pure: no — reads the policy store
Source: src/services/leave/calculateLeaveBalance.ts

### Node: policy-store
Type: Store
Name: leavePolicyCache
TTL: 15 minutes

### Node: has-carry-over
Type: Decision
Name: Carry-over allowed?
Condition: policy.carryOver && year > joiningYear

### Node: balance
Type: Output
Name: LeaveBalance
Shape: { entitled, taken, carriedOver, remaining }

## Workflow: compute-balance

Name: Compute a leave balance
Roles: Calling code

Steps:
1. caller
2. params
3. calculate-leave-balance
4. policy-store (read) — grade policy, cached for 15 minutes
5. has-carry-over
6. balance — remaining = entitled + carriedOver - taken

Errors:
- at policy-store: no policy configured for the employee's grade
- at calculate-leave-balance -> negative-balance: taken days exceed entitlement plus carry-over
