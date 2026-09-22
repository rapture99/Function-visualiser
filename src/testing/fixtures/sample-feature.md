# App: Date range picker

Scope: feature
Owner: Design system

**Feature scope**: one component and everything it touches. Between whole-app and
single-function — the level most useful for onboarding someone onto a specific screen.

### Node: user
Type: Actor
Name: User

### Node: date-range-picker
Type: Component
Name: DateRangePicker
Component: src/components/DateRangePicker.tsx
Props: value, onChange, minDate, maxDate, disableHolidays

### Node: use-date-range
Type: Hook
Name: useDateRange
Source: src/components/DateRangePicker/useDateRange.ts

### Node: holiday-cache
Type: Cache
Name: holidayCache
TTL: 24 hours

### Node: holidays-api
Type: Endpoint
Name: GET /api/holidays
Method: GET
Path: /api/holidays

### Node: range-state
Type: State
Name: { start, end, hovered }

### Node: validate-range
Type: Validation
Name: Range is valid?
Condition: end >= start && no disabled day inside the range

### Node: on-change
Type: Output
Name: onChange(range)

## Workflow: pick-a-range

Name: Pick a date range
Roles: User

Steps:
1. user
2. date-range-picker — clicks a start date
3. use-date-range
4. holiday-cache (read)
5. holidays-api — only on a cache miss
6. range-state (write) — hovered range updates as the pointer moves
7. validate-range
8. on-change — fires once both ends are set and valid

Errors:
- at validate-range: end date is before the start date
- at holidays-api: request failed, the picker falls back to cached holidays
