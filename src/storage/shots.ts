import { Directory, File, Paths } from 'expo-file-system';
import type { SceneLight, SimulatedExposure } from '../pipeline/exposure';

export interface Shot {
  id: string;
  createdAt: number;
  profileId: string;
  /** The name the phone would have given the file, e.g. IMG_0042.JPG. */
  fileName: string;
  width: number;
  height: number;
  bytes: number;
  front: boolean;
  flash: boolean;
  seed: number;
  exposure: SimulatedExposure;
  scene: SceneLight;
  /** Where the shot came from: the live camera or a re-developed photo. */
  origin: 'camera' | 'import' | 'redevelop';
  savedToLibrary?: boolean;
}

export interface ShotFiles {
  dir: Directory;
  developed: File;
  original: File;
  meta: File;
}

const root = () => new Directory(Paths.document, 'shots');

export function shotFiles(shot: Pick<Shot, 'id' | 'fileName'>): ShotFiles {
  const dir = new Directory(root(), shot.id);
  return {
    dir,
    developed: new File(dir, shot.fileName),
    original: new File(dir, 'original.jpg'),
    meta: new File(dir, 'meta.json'),
  };
}

export function newShotId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function saveShot(shot: Shot, developed: Uint8Array, original: Uint8Array): Shot {
  const files = shotFiles(shot);
  files.dir.create({ intermediates: true, idempotent: true });
  files.developed.write(developed);
  files.original.write(original);
  files.meta.write(JSON.stringify(shot));
  return shot;
}

export function updateShot(shot: Shot): void {
  shotFiles(shot).meta.write(JSON.stringify(shot));
}

export function listShots(): Shot[] {
  const dir = root();
  if (!dir.exists) return [];
  const shots: Shot[] = [];
  for (const entry of dir.list()) {
    if (!(entry instanceof Directory)) continue;
    try {
      const meta = new File(entry, 'meta.json');
      if (meta.exists) shots.push(JSON.parse(meta.textSync()));
    } catch {
      // A half-written shot; skip it.
    }
  }
  return shots.sort((a, b) => b.createdAt - a.createdAt);
}

export function getShot(id: string): Shot | null {
  try {
    const meta = new File(root(), id, 'meta.json');
    return meta.exists ? JSON.parse(meta.textSync()) : null;
  } catch {
    return null;
  }
}

export function deleteShot(shot: Shot): void {
  const { dir } = shotFiles(shot);
  if (dir.exists) dir.delete();
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function onShotsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyShotsChanged(): void {
  listeners.forEach((l) => l());
}
