/**
 * Préférences des utilisateurs (langue…). Fichier JSON écrit de façon atomique (fichier temporaire
 * puis renommage), différé de 300 ms pour regrouper les écritures. Sans dossier : mémoire seulement.
 * Pour beaucoup d'utilisateurs, remplacez par SQLite/Postgres en gardant la même interface.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type Prefs = { lang?: 'fr' | 'en'; [k: string]: unknown };

export class Store {
  private data: { users: Record<string, Prefs> } = { users: {} };
  private timer: NodeJS.Timeout | null = null;
  private readonly file: string | null;

  constructor(dataDir: string) {
    this.file = dataDir ? join(dataDir, 'bot.json') : null;
    if (this.file && existsSync(this.file)) {
      try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); } catch { /* fichier illisible : état vide */ }
    }
    this.data.users ??= {};
  }

  get(userId: string): Prefs {
    return this.data.users[userId] || {};
  }

  set(userId: string, patch: Prefs): Prefs {
    const next = { ...this.get(userId), ...patch };
    this.data.users[userId] = next;
    this.save();
    return next;
  }

  count(): number {
    return Object.keys(this.data.users).length;
  }

  private save() {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
    this.timer.unref();
  }

  flush() {
    if (!this.file) return;
    if (this.timer) clearTimeout(this.timer);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
