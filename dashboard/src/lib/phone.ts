// Phone numbers are stored the way the WhatsApp Cloud API reports wa_id:
// international digits only, no '+' and no separators.
//
// Parsing is delegated to libphonenumber-js, which knows the real numbering plans —
// it strips Argentina's local dialing prefixes (the leading 0 and the mobile 15),
// resolves 2/3/4-digit area codes, and rejects malformed input.

import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

export const DefaultCountry: CountryCode = "AR";

/**
 * Turns whatever an admin typed into WhatsApp's wa_id format. Returns null for
 * blank input, and null for anything libphonenumber considers invalid.
 *
 *   11 3456-7890      -> 5491134567890
 *   011 15 3456-7890  -> 5491134567890
 *   +54 9 11 3456...  -> 5491134567890
 *   +1 415 555 2671   -> 14155552671
 *
 * Argentina needs special handling: "11 3456-7890" is ambiguous between a landline
 * and a mobile, and libphonenumber resolves it to a landline (+541134567890, no 9).
 * WhatsApp only exists on mobiles and these fields are labelled "Celular", so the
 * mobile marker is forced on. Numbers already carrying it are left alone.
 */
export function normalizeWhatsappPhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = DefaultCountry,
): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed) return null;

  let nationalNumber = parsed.nationalNumber;

  if (parsed.country === "AR") {
    nationalNumber = restoreBuenosAiresAreaCode(nationalNumber);

    if (!nationalNumber.startsWith("9")) {
      nationalNumber = `9${nationalNumber}`;
    }
  }

  const candidate = `${parsed.countryCallingCode}${nationalNumber}`;

  // Validate the number we are about to store, not the one that was typed —
  // forcing the mobile marker above changes what is being judged.
  const final = parsePhoneNumberFromString(`+${candidate}`);
  if (!final?.isValid()) return null;

  return candidate;
}

/**
 * Buenos Aires mobiles are routinely written as "15" + 8 digits, dropping the 11
 * area code entirely ("15 5479-8800"). libphonenumber accepts that shape and reads
 * the 15 as if it were an area code, which silently yields a different number — so
 * it has to be repaired before parsing continues.
 *
 * Unambiguous: no Argentine area code begins with 15, it is reserved as the mobile
 * prefix. Outside Buenos Aires the same habit produces 9 digits or fewer, which
 * fails validation rather than landing here.
 */
function restoreBuenosAiresAreaCode(nationalNumber: string): string {
  if (nationalNumber.length === 10 && nationalNumber.startsWith("15")) {
    return `11${nationalNumber.slice(2)}`;
  }
  return nationalNumber;
}

/** E.164: 8-15 digits, no leading zero. Mirrors the DB check constraint. */
export function isValidWhatsappPhone(value: string): boolean {
  return /^[1-9][0-9]{7,14}$/.test(value);
}
