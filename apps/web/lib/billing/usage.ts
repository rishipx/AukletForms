import type { Profile } from '@/lib/types';

/** The database rolls an expired cycle over on the next submission, so show 0 until then. */
export function effectiveUsage(profile: Profile, now: Date = new Date()): number {
  return new Date(profile.cycle_resets_at).getTime() <= now.getTime() ? 0 : profile.current_cycle_usage;
}
