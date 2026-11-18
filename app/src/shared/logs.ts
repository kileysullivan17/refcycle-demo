// Append-only JSON Lines logs under app/logs (ignored by git). A failed write never breaks a request.
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

// A public page can post to the display-swap log as often as it likes, so that file stops growing at this
// size. Display never depends on a log write. Other logs are bounded by the demo limits and take no cap.
export const MAX_LOG_BYTES = 5 * 1024 * 1024;
const sizes = new Map<string, number>();

export async function appendLog(logsDir: string, file: string, record: Record<string, unknown>, maxBytes = Infinity): Promise<void> {
  try {
    const target = path.join(logsDir, file);
    let size = sizes.get(target);
    if (size === undefined) {
      size = await stat(target).then((info) => info.size, () => 0);
    }
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...record }) + '\n';
    const bytes = Buffer.byteLength(line);
    if (size + bytes > maxBytes) {
      sizes.set(target, size);
      return;
    }
    sizes.set(target, size + bytes);
    await mkdir(logsDir, { recursive: true });
    await appendFile(target, line, 'utf8');
  } catch {
    console.error(`Log write failed: ${file}`);
  }
}
