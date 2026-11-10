type Level = 'info' | 'warn' | 'error';

/**
 * One JSON object per line so Workers Logs can index the fields.
 * Never pass submission payloads or secrets in `fields`.
 */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
