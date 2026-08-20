import { IntentValidator } from "./features/inbound/intentValidator";
import { AuthContextService } from "./features/security/authContext";

function main(): void {
  const authService = new AuthContextService("test-secret", {
    now: () => new Date("2026-08-20T06:30:00.000Z"),
    ttlSeconds: 120,
  });

  const validator = new IntentValidator(authService);

  const authContext = authService.create({
    chatId: "6285712612218@c.us",
    chatType: "private",
    senderId: "6285712612218@c.us",
    senderPhone: "6285712612218",
    role: "technician",
    isRegisteredUser: true,
    sessionKey: "wa:private:6285712612218@c.us",
    policyVersion: "2026-08-20",
    requestId: "req_allowed",
  });

  const allowedResult = validator.validate({
    authContext,
    typedIntentCandidate: {
      intent_version: "v1",
      intent_name: "veeam.lookup_backup_summary",
      confidence: 0.91,
      target_scope: "no_target",
      target_ref: null,
      arguments: {
        date_range: "today",
        job_name: "backup-job-01",
      },
      request_id: "req_allowed",
    },
  });

  const deniedRoleResult = validator.validate({
    authContext: authService.create({
      chatId: "6281111111111@c.us",
      chatType: "private",
      senderId: "6281111111111@c.us",
      senderPhone: "6281111111111",
      role: "user",
      isRegisteredUser: true,
      sessionKey: "wa:private:6281111111111@c.us",
      policyVersion: "2026-08-20",
      requestId: "req_denied_role",
    }),
    typedIntentCandidate: {
      intent_version: "v1",
      intent_name: "ad.lookup_user_profile",
      confidence: 0.8,
      target_scope: "resolved_user",
      target_ref: {
        type: "employee_id",
        value: "12345",
      },
      arguments: {
        fields: ["displayName", "mail"],
      },
      request_id: "req_denied_role",
    },
  });

  const deniedArgumentResult = validator.validate({
    authContext: authService.create({
      chatId: "6285712612218@c.us",
      chatType: "private",
      senderId: "6285712612218@c.us",
      senderPhone: "6285712612218",
      role: "technician",
      isRegisteredUser: true,
      sessionKey: "wa:private:6285712612218@c.us",
      policyVersion: "2026-08-20",
      requestId: "req_denied_args",
    }),
    typedIntentCandidate: {
      intent_version: "v1",
      intent_name: "veeam.lookup_job_status",
      confidence: 0.7,
      target_scope: "no_target",
      target_ref: null,
      arguments: {
        filter: "status=failed",
      },
      request_id: "req_denied_args",
    },
  });

  console.log(
    JSON.stringify(
      {
        authContextVerification: authService.verify(authContext),
        allowedResult,
        deniedRoleResult,
        deniedArgumentResult,
      },
      null,
      2,
    ),
  );
}

main();
