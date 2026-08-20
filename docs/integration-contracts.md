# Integration Contracts

## Purpose
Define the typed request and response contracts between:
- WhatsApp bridge and Marisa
- validator and backend adapters
- backend adapters and the final Marisa summarization step

This document exists so the system can validate model output deterministically before any backend execution occurs.

## End-to-End Contract Shape
```text
OpenWA webhook
-> trusted AuthContext
-> Marisa typed intent generation
-> local validator
-> approved adapter call
-> redacted adapter result
-> Marisa final summary
-> WhatsApp response
```

## Typed Intent Contract

### Principles
- model output must be structured JSON
- intent names come from an allowlist
- all optional fields must be explicit, never inferred by the validator
- validator owns acceptance or rejection

### Intent Envelope
```json
{
  "intent_version": "v1",
  "intent_name": "veeam.lookup_backup_summary",
  "confidence": 0.92,
  "target_scope": "self",
  "target_ref": null,
  "arguments": {
    "date_range": "today",
    "job_name": null
  },
  "reasoning_summary": "User requests today's backup status.",
  "request_id": "req_xxx"
}
```

### Required Fields
- `intent_version`
- `intent_name`
- `confidence`
- `target_scope`
- `arguments`
- `request_id`

### Allowed `target_scope` Values
- `self`
- `resolved_user`
- `no_target`

### Invalid Output Examples
- missing `intent_name`
- free-text instead of JSON
- `target_scope=any_user`
- arbitrary `arguments.filter`
- unknown `intent_version`

## Initial Intent Allowlist

### Self-Service Intents
- `ad.get_self_profile`
- `ad.get_self_status`
- `veeam.lookup_self_related_status`

### Technician Read-Only Intents
- `ad.lookup_user_profile`
- `ad.lookup_user_status`
- `veeam.lookup_backup_summary`
- `veeam.lookup_job_status`
- `veeam.lookup_restore_points`

### Explicitly Excluded for Initial Rollout
- password reset
- account unlock mutation
- create user
- update group membership
- delete or disable operations
- arbitrary search or raw report export

## Validator Contract

### Inputs
- signed `AuthContext`
- typed intent JSON

### Output
```json
{
  "allowed": true,
  "validated_intent_name": "veeam.lookup_backup_summary",
  "validated_target_scope": "self",
  "validated_target_ref": null,
  "normalized_arguments": {
    "date_range": "today",
    "job_name": null
  },
  "denial_code": null
}
```

### Validator Responsibilities
- verify `AuthContext`
- verify intent schema
- verify role against intent allowlist
- verify `target_scope`
- normalize arguments to adapter-safe values
- reject unknown or ambiguous fields

### Denial Codes
- `auth.invalid_signature`
- `auth.expired`
- `intent.invalid_schema`
- `intent.unknown_name`
- `intent.role_denied`
- `intent.target_scope_denied`
- `intent.arguments_invalid`

## Adapter Contracts

### Adapter Principles
- adapters are local trusted modules or trusted internal services controlled by the WhatsApp bridge owner
- adapters expose typed read-only operations
- adapters return stable structured payloads
- adapters never expose backend-native query primitives

### AD Adapter Contract
#### Request
```json
{
  "operation": "ad.lookup_user_profile",
  "request_id": "req_xxx",
  "caller_role": "technician",
  "target_ref": {
    "type": "employee_id",
    "value": "12345"
  },
  "arguments": {
    "fields": ["displayName", "mail", "title", "department", "passwordLastChanged"]
  }
}
```

#### Response
```json
{
  "success": true,
  "code": "ok",
  "operation_id": "op_xxx",
  "data": {
    "displayName": "Widji Santoso",
    "mail": "widji.santoso@example.com",
    "title": "Technician",
    "department": "ICT",
    "passwordLastChanged": "2026-08-18T03:14:25.000Z"
  }
}
```

### Veeam Adapter Contract
#### Request
```json
{
  "operation": "veeam.lookup_backup_summary",
  "request_id": "req_xxx",
  "caller_role": "technician",
  "target_ref": null,
  "arguments": {
    "date_range": "today",
    "job_name": "backup-job-01"
  }
}
```

#### Response
```json
{
  "success": true,
  "code": "ok",
  "operation_id": "op_xxx",
  "data": {
    "jobName": "backup-job-01",
    "status": "healthy",
    "successCount": 16,
    "warningCount": 0,
    "failedCount": 0,
    "lastSyncAt": "2026-08-20T10:20:00.000Z"
  }
}
```

## Result Redaction Contract

### Pre-Summary Result Envelope
```json
{
  "request_id": "req_xxx",
  "intent_name": "veeam.lookup_backup_summary",
  "success": true,
  "safe_result": {
    "jobName": "backup-job-01",
    "status": "healthy",
    "successCount": 16,
    "warningCount": 0,
    "failedCount": 0,
    "lastSyncAt": "2026-08-20T10:20:00.000Z"
  },
  "redactions": []
}
```

### Summary Rules for Marisa
- Marisa receives only `safe_result`
- Marisa must not invent hidden backend details
- final answer should stay consistent with `safe_result`
- if `success=false`, Marisa should phrase the stable error message only

## ACK and Final Response Contract

### Early ACK
```json
{
  "request_id": "req_xxx",
  "ack_text": "Baik, permintaan sedang diproses."
}
```

### Final Response
```json
{
  "request_id": "req_xxx",
  "final_text": "Status backup hari ini healthy. 16 job berhasil, warning 0, gagal 0."
}
```

## Contract Evolution Rules
- bump `intent_version` or `auth_version` only for breaking changes
- add new intents one-by-one behind explicit policy approval
- every new adapter field must be reviewed for redaction and audit impact
