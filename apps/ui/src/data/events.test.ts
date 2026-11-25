import { describe, expect, it } from 'vitest';
import { activeEventsLocal, eventKicker, formatReleaseDayMonth, isEventLive, isEventReleased, localIsoDate } from './events';

describe('F11 release events date logic', () => {
  const sampleEvent = {
    id: 'avengers-doomsday',
    release: '2026-12-16',
    start: '2026-12-09',
    end: '2027-01-31',
  };

  it('evaluates live dates inclusively in local date format', () => {
    expect(isEventLive(sampleEvent, '2026-12-08')).toBe(false);
    expect(isEventLive(sampleEvent, '2026-12-09')).toBe(true);
    expect(isEventLive(sampleEvent, '2027-01-31')).toBe(true);
    expect(isEventLive(sampleEvent, '2027-02-01')).toBe(false);
    expect(localIsoDate(new Date(2026, 10, 25))).toBe('2026-11-25');
  });

  it('switches kicker from release date countdown to In cinemas now on release day', () => {
    expect(isEventReleased(sampleEvent, '2026-12-15')).toBe(false);
    expect(eventKicker(sampleEvent, '2026-12-15')).toBe('In cinemas 16 December');
    expect(isEventReleased(sampleEvent, '2026-12-16')).toBe(true);
    expect(eventKicker(sampleEvent, '2026-12-16')).toBe('In cinemas now');
    expect(formatReleaseDayMonth('2026-11-20')).toBe('20 November');
  });

  it('activates Sunrise on the Reaping from bundled events on 2026-11-25', () => {
    const live = activeEventsLocal(new Date(2026, 10, 25));
    expect(live.some((entry) => entry.id === 'sunrise-on-the-reaping')).toBe(true);
    expect(live.find((entry) => entry.id === 'sunrise-on-the-reaping')?.kicker).toBe('In cinemas now');
  });
});
