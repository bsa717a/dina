/**
 * Re-export shared mail triage.
 * Prefer importing from @/lib/mail/triage in new code.
 */
export {
  classifyMailNoise,
  partitionMailByTriage,
  type MailTriageInput,
  type MailTriageResult,
} from "@/lib/mail/triage";
