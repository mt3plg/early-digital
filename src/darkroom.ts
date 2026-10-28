import { Skia } from '@shopify/react-native-skia';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useSyncExternalStore } from 'react';
import { develop, type DevelopStage } from './pipeline/develop';
import type { SkiaApi } from './pipeline/skia';
import { getProfile } from './profiles';
import { loadSettings, nextFileIndex } from './storage/settings';
import { newShotId, notifyShotsChanged, saveShot, shotFiles, updateShot, type Shot } from './storage/shots';

export interface DevelopJob {
  id: string;
  profileId: string;
  fileName: string;
  stage: DevelopStage | 'queued' | 'done' | 'error';
  error?: string;
  shotId?: string;
}

export interface DevelopRequest {
  source: Uint8Array;
  profileId: string;
  front?: boolean;
  flash?: boolean;
  origin: Shot['origin'];
  seed?: number;
}

// ---- tiny external store for the developing tray ------------------------

let jobs: DevelopJob[] = [];
const subscribers = new Set<() => void>();

function setJobs(next: DevelopJob[]) {
  jobs = next;
  subscribers.forEach((s) => s());
}

function patchJob(id: string, patch: Partial<DevelopJob>) {
  setJobs(jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
}

export function useDevelopJobs(): DevelopJob[] {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    () => jobs,
  );
}

// ---- serial queue: one GPU job at a time keeps memory predictable --------

let chain: Promise<unknown> = Promise.resolve();

export function enqueueDevelop(req: DevelopRequest): Promise<Shot> {
  const profile = getProfile(req.profileId);
  const fileName = profile.fileName(nextFileIndex(profile.id));
  const job: DevelopJob = { id: newShotId(), profileId: profile.id, fileName, stage: 'queued' };
  setJobs([...jobs, job]);

  const run = async (): Promise<Shot> => {
    try {
      const res = await develop(Skia as SkiaApi, req.source, {
        profile,
        front: req.front,
        flash: req.flash,
        seed: req.seed,
        onStage: (stage) => patchJob(job.id, { stage }),
      });
      const shot: Shot = {
        id: job.id,
        createdAt: Date.now(),
        profileId: profile.id,
        fileName,
        width: res.width,
        height: res.height,
        bytes: res.jpeg.length,
        front: !!req.front,
        flash: !!req.flash && profile.flash != null,
        seed: res.seed,
        exposure: res.exposure,
        scene: res.scene,
        origin: req.origin,
      };
      saveShot(shot, res.jpeg, req.source);
      notifyShotsChanged();
      patchJob(job.id, { stage: 'done', shotId: shot.id });
      if (loadSettings().autoSave) {
        saveToLibrary(shot).catch((e) => console.warn('Auto-save failed', e));
      }
      return shot;
    } catch (e) {
      patchJob(job.id, { stage: 'error', error: String(e) });
      throw e;
    } finally {
      setTimeout(() => setJobs(jobs.filter((j) => j.id !== job.id)), 1800);
    }
  };

  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}

/** Re-develops a stored shot's original through another camera. */
export function redevelop(shot: Shot, profileId: string): Promise<Shot> {
  const source = shotFiles(shot).original.bytesSync();
  return enqueueDevelop({ source, profileId, front: shot.front, flash: shot.flash, origin: 'redevelop' });
}

export async function saveToLibrary(shot: Shot): Promise<void> {
  const perm = await requestPermissionsAsync(true, ['photo']);
  if (!perm.granted) throw new Error('Photo library access was not granted');
  await Asset.create(shotFiles(shot).developed.uri);
  updateShot({ ...shot, savedToLibrary: true });
  notifyShotsChanged();
}
