import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "seen.json");
const MAX = 500; // 최근 N개만 유지

export interface Seen {
  ids: string[];
}

export function loadSeen(): Seen {
  try {
    const raw = fs.readFileSync(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return { ids: Array.isArray(parsed.ids) ? parsed.ids : [] };
  } catch {
    return { ids: [] };
  }
}

export function isNew(seen: Seen, id: string): boolean {
  return !!id && !seen.ids.includes(id);
}

export function markSeen(seen: Seen, id: string): void {
  if (!id) return;
  seen.ids.push(id);
  if (seen.ids.length > MAX) {
    seen.ids = seen.ids.slice(-MAX);
  }
}

export function saveSeen(seen: Seen): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(seen, null, 2), "utf-8");
}
