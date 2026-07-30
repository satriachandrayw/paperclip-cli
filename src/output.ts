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

export function printOutput(value: unknown, json = false): void {
  const safe = redactSecrets(value);
  if (json || typeof safe === "object") {
    console.log(JSON.stringify(safe, null, 2));
    return;
  }
  console.log(String(safe ?? ""));
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
