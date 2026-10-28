import { File, Paths } from 'expo-file-system';

export interface Settings {
  profileId: string;
  /** Phone-screen viewfinder plus period shutter lag. */
  authentic: boolean;
  autoSave: boolean;
  flash: boolean;
  /** Per-profile file counters, so names continue like on the real phone. */
  counters: Record<string, number>;
}

const DEFAULTS: Settings = {
  profileId: 'zeiss-2007',
  authentic: false,
  autoSave: true,
  flash: false,
  counters: {},
};

const file = () => new File(Paths.document, 'settings.json');

let cache: Settings | null = null;

export function loadSettings(): Settings {
  if (cache) return cache;
  try {
    const f = file();
    cache = f.exists ? { ...DEFAULTS, ...JSON.parse(f.textSync()) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  cache = next;
  try {
    file().write(JSON.stringify(next));
  } catch (e) {
    console.warn('Could not persist settings', e);
  }
  return next;
}

/** Returns the next file number for a profile and persists it. */
export function nextFileIndex(profileId: string): number {
  const s = loadSettings();
  const n = (s.counters[profileId] ?? 0) + 1;
  saveSettings({ counters: { ...s.counters, [profileId]: n } });
  return n;
}
