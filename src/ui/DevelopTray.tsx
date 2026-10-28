import { StyleSheet, Text, View } from 'react-native';
import { useDevelopJobs } from '../darkroom';
import { DEVELOP_STAGES } from '../pipeline/develop';
import { colors, mono } from './theme';

const LABELS: Record<string, string> = {
  queued: 'QUEUED',
  decode: 'DECODE',
  optics: 'LENS',
  sensor: 'SENSOR',
  isp: 'ISP',
  denoise: 'NOISE RED.',
  sharpen: 'SHARPEN',
  jpeg: 'JPEG',
  done: 'SAVED',
  error: 'FAILED',
};

/** Shows the photo currently being developed, stage by stage. */
export function DevelopTray() {
  const jobs = useDevelopJobs();
  const job = jobs.find((j) => j.stage !== 'done' && j.stage !== 'error') ?? jobs[jobs.length - 1];
  if (!job) return null;
  const idx = DEVELOP_STAGES.indexOf(job.stage as never);
  const done = job.stage === 'done';
  const pending = jobs.filter((j) => j.stage === 'queued').length;

  return (
    <View style={styles.tray} accessibilityLiveRegion="polite">
      <Text style={styles.name} numberOfLines={1}>
        {job.fileName}
        {pending > 1 ? `  +${pending - 1}` : ''}
      </Text>
      <View style={styles.bar}>
        {DEVELOP_STAGES.map((s, i) => (
          <View key={s} style={[styles.seg, (done || i <= idx) && styles.segOn, job.stage === 'error' && styles.segErr]} />
        ))}
      </View>
      <Text style={[styles.stage, job.stage === 'error' && { color: colors.danger }]}>{LABELS[job.stage]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(22,22,24,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  name: { fontFamily: mono, fontSize: 11, color: colors.text, maxWidth: 150 },
  bar: { flexDirection: 'row', gap: 2 },
  seg: { width: 8, height: 4, borderRadius: 1, backgroundColor: colors.line },
  segOn: { backgroundColor: colors.accent },
  segErr: { backgroundColor: colors.danger },
  stage: { fontFamily: mono, fontSize: 10, color: colors.accent, letterSpacing: 1, minWidth: 66 },
});
