'use strict';
require('../src/bootstrap');
const test = require('node:test');
const assert = require('node:assert');
const s = require('../src/schedule');

const base = {
  freq_type: 'daily', interval_value: 1, interval_unit: 'day',
  weekly_day: 1, monthly_day: 15, time_str: '08:00', start_date: '2026-11-01', lead_min: 0
};

test('once returns fixed occurrence', () => {
  const r = { ...base, freq_type: 'once', start_date: '2026-11-20', time_str: '09:30' };
  assert.equal(s.firstOccurrence(r, s.parseLocal('2026-11-18', '10:00')), s.parseLocal('2026-11-20', '09:30'));
});

test('daily rolls to tomorrow when time passed', () => {
  const now = s.parseLocal('2026-11-18', '09:00');
  assert.equal(s.nextOccurrence(base, now), s.parseLocal('2026-11-19', '08:00'));
});

test('daily keeps today when time still ahead', () => {
  const now = s.parseLocal('2026-11-18', '07:00');
  assert.equal(s.nextOccurrence(base, now), s.parseLocal('2026-11-18', '08:00'));
});

test('weekly picks matching weekday strictly after now', () => {
  const r = { ...base, freq_type: 'weekly', weekly_day: 3 }; // Wednesday
  const now = s.parseLocal('2026-11-18', '09:00'); // Wednesday
  assert.equal(s.nextOccurrence(r, now), s.parseLocal('2026-11-25', '08:00'));
  const now2 = s.parseLocal('2026-11-18', '07:00');
  assert.equal(s.nextOccurrence(r, now2), s.parseLocal('2026-11-18', '08:00'));
});

test('interval hours steps from anchor', () => {
  const r = { ...base, freq_type: 'interval', interval_value: 8, interval_unit: 'hour', start_date: '2026-11-18', time_str: '08:30' };
  const now = s.parseLocal('2026-11-18', '09:00');
  assert.equal(s.nextOccurrence(r, now), s.parseLocal('2026-11-18', '16:30'));
  const now2 = s.parseLocal('2026-11-18', '17:00');
  assert.equal(s.nextOccurrence(r, now2), s.parseLocal('2026-11-19', '00:30'));
});

test('monthly clamps day to month length', () => {
  const r = { ...base, freq_type: 'monthly', monthly_day: 31, start_date: '2026-01-01' };
  const now = s.parseLocal('2026-02-01', '00:00');
  assert.equal(s.nextOccurrence(r, now), s.parseLocal('2026-02-28', '08:00'));
  const now2 = s.parseLocal('2026-03-01', '00:00');
  assert.equal(s.nextOccurrence(r, now2), s.parseLocal('2026-03-31', '08:00'));
});

test('lead time shifts fire earlier', () => {
  const occ = s.parseLocal('2026-11-18', '10:00');
  assert.equal(s.fireAt(occ, 15), occ - 15 * 60000);
  assert.equal(s.fireAt(occ, 0), occ);
});

test('advance skips the occurrence just completed', () => {
  const r = { ...base, occurrence_at: s.parseLocal('2026-11-18', '08:00') };
  const now = s.parseLocal('2026-11-18', '08:05');
  assert.equal(s.advance(r, now), s.parseLocal('2026-11-19', '08:00'));
});

test('repeat never schedules before start_date', () => {
  const r = { ...base, start_date: '2026-12-01' };
  const now = s.parseLocal('2026-11-18', '09:00');
  assert.equal(s.nextOccurrence(r, now), s.parseLocal('2026-12-01', '08:00'));
});

test('freqLabel renders human copy', () => {
  assert.equal(s.freqLabel({ ...base, freq_type: 'weekly', weekly_day: 3 }), '每周三');
  assert.equal(s.freqLabel({ ...base, freq_type: 'interval', interval_value: 8, interval_unit: 'hour' }), '每8小时');
  assert.equal(s.freqLabel({ ...base, freq_type: 'monthly', monthly_day: 25 }), '每月25日');
});