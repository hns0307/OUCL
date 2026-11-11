import type { LaunchProfiles, RegisteredJava } from '../storage/launch-profiles.js';

/** Shared measurement budget and stable preference order for inspection and launch. */
export const JAVA_PROBE_TIMEOUT_MS = 8000;
/** Never ranks an unmeasured saved patch version above the explicitly selected JVM. */
export function registeredJavaCandidates(saved: LaunchProfiles, major: number): RegisteredJava[] {
  return [...saved.javas].filter(java => java.major === major)
    .sort((a, b) => Number(b.javaId === saved.selectedJavaId) - Number(a.javaId === saved.selectedJavaId));
}
