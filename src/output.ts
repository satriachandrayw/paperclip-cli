const SECRET_KEY = /(api[-_]?key|access[-_]?token|auth(?:orization)?|bearer|cookie|credential|jwt|pass(word)?|private[-_]?key|secret|token)/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const isSecretValue = SECRET_KEY.test(key) && !/(env(var)?name|keyname|secretname)$/i.test(key);
    output[key] = isSecretValue ? "[REDACTED]" : redactSecrets(child);
  }
  return output;
}

export function printOutput(value: unknown, json = false, options?: { revealSecrets?: boolean }): void {
  const safe = options?.revealSecrets ? value : redactSecrets(value);
  if (json || (safe !== null && typeof safe === "object")) {
    console.log(JSON.stringify(safe, null, 2));
    return;
  }
  console.log(String(safe ?? ""));
}

/**
 * Prints a response that intentionally carries a one-time credential (for example a
 * freshly created agent API key). Disables redaction and warns on stderr so the value
 * is never mistaken for a redacted placeholder.
 */
export function printRevealedSecret(value: unknown, json = false, warning?: string): void {
  console.error(warning ?? "This response contains a credential that is shown once. Store it now; it cannot be read again.");
  printOutput(value, json, { revealSecrets: true });
}

export function printRows(rows: unknown[], json: boolean): void {
  if (json) {
    printOutput(rows, true);
    return;
  }
  if (rows.length === 0) {
    console.log("(empty)");
    return;
  }
  for (const row of rows) {
    if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      const keys = ["identifier", "id", "name", "title", "status", "priority", "role"];
      const shown = keys.filter((key) => record[key] !== undefined).map((key) => `${key}=${String(record[key])}`);
      console.log(shown.length ? shown.join(" ") : JSON.stringify(redactSecrets(row)));
    } else {
      console.log(String(row));
    }
  }
}
