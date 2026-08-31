const RESERVED_KEYS = new Set([
  // Fixed columns on Employee. A dynamic field may not shadow one of these,
  // or reads would silently disagree about which value is authoritative.
  "id",
  "account_id",
  "full_name",
  "phone_e164",
  "email",
  "status",
  "employment_type",
  "job_title",
  "start_date",
  "end_date",
  "attributes",
  "external_ref",
  "created_at",
  "updated_at",
]);

/**
 * Derive a stable `attributes` key from a human label.
 *
 * Owners describe fields in their own words ("Hourly Rate ($)", "Food
 * handler card exp."), and those words change. The key must not: it is the
 * jsonb object key and appears in every `DataChange` row, so renaming it
 * would orphan history. Labels are therefore editable and keys are not.
 */
export function toFieldKey(label: string): string {
  const base = label
    .normalize("NFKD")
    // Strip accents so "Años" and "Anos" don't produce different keys.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");

  if (base === "") return "field";
  // A leading digit is legal in jsonb but awkward in every other context.
  return /^[0-9]/.test(base) ? `f_${base}` : base;
}

export function isReservedFieldKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/**
 * Produce a key that collides with neither reserved names nor keys already
 * in use. Roster import routinely proposes several columns that slugify to
 * the same thing ("Phone", "Phone 2"), and silently dropping one would lose
 * an owner's data.
 */
export function uniqueFieldKey(
  label: string,
  taken: Iterable<string>,
): string {
  const takenSet = new Set(taken);
  const base = toFieldKey(label);
  let candidate = isReservedFieldKey(base) ? `${base}_field` : base;

  let suffix = 2;
  while (takenSet.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}
