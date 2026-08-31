/**
 * Roster lookup: map phone number → teammate/project.
 *
 * Uses the existing User table with the new phoneNumber field.
 * Does NOT auto-provision unknown numbers.
 */

import { prisma } from "@/lib/db/client";
import { toAuthUser } from "@/lib/auth/types";
import { listMemberProjectKeys } from "@/lib/project-tasks/membership";
import type { RosterLookupResult } from "./types";

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  if (digits.length > 10) {
    return `+${digits}`;
  }

  return phone.trim();
}

export function isValidE164(phone: string): boolean {
  return E164_REGEX.test(phone);
}

export async function lookupByPhoneNumber(
  rawPhone: string,
): Promise<RosterLookupResult> {
  const phoneNumber = normalizePhoneNumber(rawPhone);

  if (!isValidE164(phoneNumber)) {
    return {
      found: false,
      phoneNumber,
      reason: "unknown_number",
    };
  }

  const row = await prisma.user.findUnique({
    where: { phoneNumber },
  });

  if (!row) {
    return {
      found: false,
      phoneNumber,
      reason: "unknown_number",
    };
  }

  const user = toAuthUser(row);
  const projectKeys = await listMemberProjectKeys(user);

  return {
    found: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      phoneNumber,
    },
    projectKeys,
  };
}

export async function findUserByPhone(rawPhone: string) {
  const result = await lookupByPhoneNumber(rawPhone);
  if (!result.found) return null;
  return result.user;
}
