import assert from 'node:assert/strict';
import test from 'node:test';
import { allCompatibility, anyCompatibility, matchesModRange as matches } from '../src/core/mods/ranges.js';

test('Maven intervals preserve each endpoint, unbounded sides and unions', () => {
  for (const [range, lower, upper] of [['[1.20,1.20.1)', 'satisfied', 'unsatisfied'], ['(1.20,1.20.1]', 'unsatisfied', 'satisfied'],
    ['[1.20,1.20.1]', 'satisfied', 'satisfied'], ['(1.20,1.20.1)', 'unsatisfied', 'unsatisfied']] as const) {
    assert.equal(matches(range, '1.20', 'maven'), lower); assert.equal(matches(range, '1.20.1', 'maven'), upper);
  }
  for (const [range, version, outcome] of [['(,1.0],[1.2,)', '1.3', 'satisfied'], ['(,1.0],[1.2,)', '1.1', 'unsatisfied'],
    ['[47.2]', '47.2', 'satisfied'], ['[47.2]', '47.3', 'unsatisfied'], ['[47,)', '46', 'unsatisfied'],
    ['[3,2)', '2', 'unknown'], ['(2)', '2', 'unknown'], ['[,]', '2', 'unknown'], ['[2,3,4]', '3', 'unknown'],
    ['[x,3]', '2', 'unknown'], ['[1,x]', '2', 'unknown'], ['[1,2', '1', 'unknown'], ['1.0', '1.0', 'unknown']]) {
    assert.equal(matches(range, version!, 'maven'), outcome, range);
  }
});
test('Fabric predicates, prereleases, opaque versions and Quilt any/all retain dialect', () => {
  for (const range of ['>=1.20.1 <1.21', '~1.20.1', '1.20.x', '1.20.*.*']) {
    assert.equal(matches(range, '1.20.4', 'fabric'), 'satisfied', range);
    assert.equal(matches(range, '1.21', 'fabric'), 'unsatisfied', range);
  }
  assert.equal(matches('^1.20.1', '1.21', 'fabric'), 'satisfied');
  assert.equal(matches('^1.20.1', '2', 'fabric'), 'unsatisfied');
  for (const [range, version, outcome] of [['^0.15.2', '0.16', 'unsatisfied'], ['^0.0.0', '0.0.1', 'unsatisfied'],
    ['~1', '1.9', 'satisfied'], ['=1.0', '1', 'satisfied'], ['>1', '2', 'satisfied'], ['<1', '2', 'unsatisfied'],
    ['<=1', '1', 'satisfied'], ['>=1-beta.2', '1-beta.10', 'satisfied'], ['>=1-beta', '1', 'satisfied'],
    ['>=1-beta', '1-alpha', 'unsatisfied'], ['>1-a.1', '1-a', 'unsatisfied'], ['>1-1', '1-a', 'satisfied'],
    ['=24w14a', '24w14a', 'satisfied'], ['>24w14a', '24w15a', 'unknown'], ['>=1.x', '1.2', 'unknown'], ['*', '24w14a', 'satisfied'],
    ['1 || 2', '2', 'satisfied'], ['>=1 && <2', '2', 'unsatisfied']]) assert.equal(matches(range, version!, 'fabric'), outcome, range);
  assert.equal(matches('1.2', '1.3', 'quilt'), 'satisfied');
  assert.equal(matches('1.2', '1.3', 'fabric'), 'unsatisfied');
  assert.equal(matches({ all: [{ any: ['1', '2'] }, '<2'] }, '1.5', 'quilt'), 'satisfied');
  assert.equal(matches(['1', '2'], '2', 'fabric'), 'satisfied');
  for (const range of [[], {}, { unless: 'x' }, { any: [] }, null, 7, '', ' '.repeat(4), 'x'.repeat(2049), ['1']]) {
    assert.equal(matches(range, '1', 'maven'), 'unknown');
  }
  for (const range of [{ any: [] }, { any: null }, {}, { all: ['>x'] }, []]) assert.equal(matches(range, '1', 'quilt'), 'unknown');
  assert.equal(matches('1', '', 'fabric'), 'unknown');
  assert.equal(matches('1', '1', 'fabric', 17), 'unknown');
  assert.equal(matches('>=99999999999999999999999', '1', 'fabric'), 'unknown');
});
test('three-valued aggregation never loses unresolved constraints', () => {
  assert.equal(allCompatibility(['satisfied', 'unknown']), 'unknown');
  assert.equal(allCompatibility(['unknown', 'unsatisfied']), 'unsatisfied');
  assert.equal(anyCompatibility(['unsatisfied', 'unknown']), 'unknown');
  assert.equal(anyCompatibility(['satisfied', 'unknown']), 'satisfied');
  assert.equal(anyCompatibility(['unsatisfied']), 'unsatisfied');
});
