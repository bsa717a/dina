import { randomBytes } from "crypto";
import {
  hashAccessCode,
  verifyHashedAccessCode,
} from "@/lib/auth/access-code";

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): string {
  return hashAccessCode(password);
}

export function verifyPassword(password: string, stored: string): boolean {
  return verifyHashedAccessCode(password, stored);
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return /^[a-z0-9_]{2,32}$/.test(normalizeUsername(value));
}

export function isValidPassword(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH && value.length <= 256;
}

export function generateTempPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let password = "";
  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }
  return password;
}
