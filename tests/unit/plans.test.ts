import { describe, expect, it } from 'vitest';
import { isActive, paidFeatureReason } from '../../src/shared/plans';
import type { Monitor } from '../../src/shared/model';

const monitor = (id: string, enabled = true, endsAt: number | null = null) =>
  ({ id, enabled, endsAt }) as Monitor;

describe('free plan boundaries', () => {
  it('requires payment below exactly five minutes', () => {
    expect(paidFeatureReason([], 299, true)).toContain('faster than 5');
    expect(paidFeatureReason([], 300, true)).toBeNull();
    expect(paidFeatureReason([], 301, true)).toBeNull();
  });
  it('allows three active monitors and rejects a fourth', () => {
    const monitors = [monitor('1'), monitor('2'), monitor('3')];
    expect(paidFeatureReason(monitors.slice(0, 2), 300, true)).toBeNull();
    expect(paidFeatureReason(monitors, 300, true)).toContain('More than 3');
    expect(paidFeatureReason(monitors, 300, true, '3')).toBeNull();
    expect(paidFeatureReason(monitors, 300, false)).toBeNull();
  });
  it('does not count paused or expired monitors', () => {
    const monitors = [
      monitor('1'),
      monitor('2', false),
      monitor('3', true, 10),
    ];
    expect(paidFeatureReason(monitors, 300, true, undefined, 10)).toBeNull();
    expect(isActive(monitors[2]!, 10)).toBe(false);
  });
});
