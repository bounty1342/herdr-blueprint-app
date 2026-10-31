// Diagrams on disk, one folder per project, inside the app's own data folder so
// nothing lands in the person's repositories:
//
//   <app home>/data/blueprint/projects/<name>-<hash>/
//     <diagram>.mmd   one Mermaid diagram each: the agent writes, Blueprint reads
//     project.json    { path, agent, pinned: [file], seen: { file: ms }, opened: ms }
//
// A project is a checkout: the git top level of the tab's terminal folder, so
// every worktree is its own project (its folder stays put while branches come
// and go), or that folder when it is not in git. Diagrams nobody updated or
// opened for KEEP_DAYS are deleted unless pinned, and a project keeps at most
// KEEP_COUNT unpinned ones.

import * as fs from "fs/promises";
import { exec, appHome, readTextFile } from "herdr";

export const KEEP_DAYS = 7;
export const KEEP_COUNT = 10;
const DAY = 86400000;

export const projectsDir = () => `${appHome()}/data/blueprint/projects`;

const checkouts = new Map(); // folder -> checkout
export async function checkoutOf(folder) {
  if (checkouts.has(folder)) return checkouts.get(folder);
  let root = folder;
  try {
    const r = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"]);
    if (r.code === 0 && r.stdout.trim()) root = r.stdout.trim();
  } catch (_) {}
  checkouts.set(folder, root);
  return root;
}

// FNV-1a: a short id that stays the same for the same path.
function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function projectDir(path) {
  const name = path.split("/").filter(Boolean).slice(-2).join("-").replace(/[^\w.-]+/g, "_") || "root";
  return `${projectsDir()}/${name}-${hash(path)}`;
}

export async function readMeta(dir, path) {
  let saved = null;
  try {
    const text = await readTextFile(`${dir}/project.json`);
    saved = text ? JSON.parse(text) : null;
  } catch (_) {}
  return { path, agent: null, pinned: [], seen: {}, opened: 0, ...saved };
}

export async function writeMeta(dir, meta) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${dir}/project.json`, JSON.stringify(meta, null, 1));
}

// *.mmd in the folder with their modified times; fs/promises has no stat.
async function listed(dir) {
  const script = 'cd "$1" 2>/dev/null || exit 0; for f in *.mmd; do [ -f "$f" ] && { stat -f "%m %N" "$f" 2>/dev/null || stat -c "%Y %n" "$f"; }; done';
  const r = await exec("sh", ["-c", script, "sh", dir]);
  return r.stdout.split("\n").filter(Boolean).map((line) => {
    const i = line.indexOf(" ");
    return { file: line.slice(i + 1), mtime: Number(line.slice(0, i)) * 1000 };
  });
}

// The project's diagrams, oldest-touched ones deleted first. Each comes back
// as { file, mtime, touched, pinned, src }, newest first.
export async function load(dir, meta, now = Date.now()) {
  const list = (await listed(dir))
    .map((f) => ({ ...f, touched: Math.max(f.mtime, meta.seen?.[f.file] ?? 0), pinned: meta.pinned.includes(f.file) }))
    .sort((a, b) => b.touched - a.touched);
  const keep = [];
  let unpinned = 0;
  for (const f of list) {
    if (f.pinned || (now - f.touched <= KEEP_DAYS * DAY && unpinned++ < KEEP_COUNT)) keep.push(f);
    else await fs.unlink(`${dir}/${f.file}`).catch(() => {});
  }
  const out = [];
  for (const f of keep) {
    const src = await readTextFile(`${dir}/${f.file}`);
    if (src != null) out.push({ ...f, src });
  }
  return out;
}

// Every project at once, when Blueprint starts: expired diagrams go, and so
// does a project folder left with no diagram and not opened for KEEP_DAYS.
export async function pruneAll(now = Date.now()) {
  let names = [];
  try {
    names = await fs.readdir(projectsDir());
  } catch (_) {
    return;
  }
  for (const name of names) {
    const dir = `${projectsDir()}/${name}`;
    const meta = await readMeta(dir, null);
    const kept = await load(dir, meta, now);
    if (kept.length || now - meta.opened <= KEEP_DAYS * DAY) continue;
    await fs.unlink(`${dir}/project.json`).catch(() => {});
    await fs.rmdir(dir).catch(() => {});
  }
}
