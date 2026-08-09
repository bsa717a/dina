/**
 * Cheap header/preview triage for mail (Outlook + Gmail).
 * High-confidence marketing/spam → mark read without fetching bodies.
 * When unsure, treat as maybe-real so important mail is not buried.
 */

export type MailTriageInput = {
  id?: string;
  subject?: string | null;
  fromAddress?: string | null;
  fromName?: string | null;
  bodyPreview?: string | null;
  /** Graph Focused Inbox: "focused" | "other" */
  inferenceClassification?: string | null;
  /** Gmail label ids, e.g. CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, SPAM */
  labelIds?: string[] | null;
  /** Raw headers that may include List-Unsubscribe */
  listUnsubscribe?: string | null;
};

export type MailTriageResult = {
  kind: "noise" | "maybe_real";
  reason: string;
  score: number;
};

const NOISE_SCORE_THRESHOLD = 4;

const AUTOMATED_LOCAL_PART =
  /^(noreply|no-reply|no_reply|donotreply|do-not-reply|do_not_reply|mailer-daemon|newsletter|news|marketing|promo|promotions|offers|deals|notifications|notify|alert|alerts|updates|digest|bounce|bounces|mailer|campaign|hello\+.*)$/i;

const MARKETING_FROM_DOMAINS =
  /(?:^|\.)(mailchimp\.com|mailchi\.mp|constantcontact\.com|cmail\d+\.com|sendgrid\.net|amazonses\.com|mandrillapp\.com|hubspot(email)?\.com|salesforce\.com|pardot\.com|marketo\.com|exacttarget\.com|campaign-archive\.com|list-manage\.com|createsend\.com|mailgun\.(org|net)|postmarkapp\.com|klaviyo\.com|braze\.com|iterable\.com|drip\.com|getresponse\.com|convertkit\.com|beehiiv\.com|substack\.com)$/i;

const NOISE_SUBJECT =
  /\b(unsubscribe|newsletter|weekly\s+digest|daily\s+digest|roundup|flash\s+sale|limited\s+time|%\s*off|percent\s+off|save\s+\d+|deal\s+of|web(?:inar)?\s+invite|view\s+in\s+browser|email\s+preferences|manage\s+(your\s+)?preferences|special\s+offer|exclusive\s+offer|last\s+chance|don'?t\s+miss|black\s+friday|cyber\s+monday|free\s+shipping)\b/i;

const NOISE_PREVIEW =
  /\b(unsubscribe|view\s+in\s+browser|manage\s+(your\s+)?(email\s+)?preferences|email\s+preferences|update\s+preferences|opt[\s-]?out|shop\s+now|buy\s+now|claim\s+your|%\s*off|free\s+shipping|this\s+email\s+was\s+sent\s+to)\b/i;

/** Known-noise product digests that are almost never reply-needed. */
const NOISE_PRODUCT_SENDERS =
  /\b(linkedin|medium\.com|product\s*hunt|dev\.to|hashnode|morning\s+brew|the\s+hustle|axios|slickdeals|retailmenot|heygen|canva|notion|figma|miro|loom|calendly|typeform|mailerlite|convertkit|truvani|aadvantage|raw\s*capital|therawcapital)\b/i;

/**
 * Commercial SaaS / video / design / consumer marketing brands.
 * Score high enough alone — these almost never need a reply from Derek.
 */
const NOISE_MARKETING_BRAND_DOMAINS =
  /(?:^|\.)(heygen\.com|canva\.com|notion\.(so|com)|figma\.com|miro\.com|loom\.com|calendly\.com|typeform\.com|mailerlite\.com|beehiiv\.com|substack\.com|truvani\.com|therawcapital\.com|aa\.com|customeriq\.io)$/i;

function parseAddress(address: string | null | undefined) {
  const raw = (address || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at <= 0) return { local: "", domain: "", raw };
  return {
    local: raw.slice(0, at),
    domain: raw.slice(at + 1),
    raw,
  };
}

/**
 * Score header/preview signals. Score >= threshold ⇒ marketing/spam noise.
 * Bias toward maybe_real when signals are weak or mixed.
 */
export function classifyMailNoise(input: MailTriageInput): MailTriageResult {
  const subject = (input.subject || "").trim();
  const preview = (input.bodyPreview || "").trim();
  const fromName = (input.fromName || "").trim();
  const { local, domain, raw: from } = parseAddress(input.fromAddress);
  const hay = `${subject}\n${preview}\n${fromName}\n${from}`;
  const labels = (input.labelIds || []).map((l) => l.toUpperCase());

  let score = 0;
  const reasons: string[] = [];

  if (AUTOMATED_LOCAL_PART.test(local)) {
    score += 3;
    reasons.push(`automated local-part (${local})`);
  }

  if (domain && MARKETING_FROM_DOMAINS.test(domain)) {
    score += 3;
    reasons.push(`marketing ESP domain (${domain})`);
  }

  if (domain && NOISE_MARKETING_BRAND_DOMAINS.test(domain)) {
    score += 4;
    reasons.push(`marketing brand domain (${domain})`);
  }

  if (NOISE_SUBJECT.test(subject)) {
    score += 2;
    reasons.push("marketing subject");
  }

  if (NOISE_PREVIEW.test(preview)) {
    score += 2;
    reasons.push("unsubscribe/CTA preview");
  }

  if (NOISE_PRODUCT_SENDERS.test(hay)) {
    score += 3;
    reasons.push("known digest/product sender");
  }

  if ((input.inferenceClassification || "").toLowerCase() === "other") {
    score += 1;
    reasons.push("Outlook Other inbox");
  }

  if (labels.includes("SPAM")) {
    score += 5;
    reasons.push("Gmail SPAM label");
  }
  if (labels.includes("CATEGORY_PROMOTIONS")) {
    score += 3;
    reasons.push("Gmail Promotions");
  }
  if (labels.includes("CATEGORY_SOCIAL")) {
    score += 2;
    reasons.push("Gmail Social");
  }
  if (labels.includes("CATEGORY_UPDATES") && NOISE_PREVIEW.test(preview)) {
    score += 1;
    reasons.push("Gmail Updates + CTA preview");
  }

  if (input.listUnsubscribe?.trim()) {
    score += 2;
    reasons.push("List-Unsubscribe header");
  }

  // Soft counter-signals: look like a person / thread, not a blast.
  const looksPersonal =
    Boolean(from) &&
    !AUTOMATED_LOCAL_PART.test(local) &&
    !MARKETING_FROM_DOMAINS.test(domain) &&
    !NOISE_MARKETING_BRAND_DOMAINS.test(domain) &&
    !labels.includes("SPAM") &&
    !labels.includes("CATEGORY_PROMOTIONS") &&
    /^(re:|fw:|fwd:)/i.test(subject);
  if (looksPersonal) {
    score -= 3;
    reasons.push("looks like personal reply/forward");
  }

  if (score >= NOISE_SCORE_THRESHOLD) {
    return {
      kind: "noise",
      score,
      reason: reasons.join("; ") || "marketing/spam signals",
    };
  }

  return {
    kind: "maybe_real",
    score,
    reason: reasons.length
      ? `weak noise signals (${reasons.join("; ")}) — reading body`
      : "no strong marketing/spam signals",
  };
}

export function partitionMailByTriage<T extends MailTriageInput>(items: T[]) {
  const noise: Array<T & { triage: MailTriageResult }> = [];
  const maybeReal: Array<T & { triage: MailTriageResult }> = [];
  for (const item of items) {
    const triage = classifyMailNoise(item);
    if (triage.kind === "noise") noise.push({ ...item, triage });
    else maybeReal.push({ ...item, triage });
  }
  return { noise, maybeReal };
}
