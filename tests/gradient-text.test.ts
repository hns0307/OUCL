import test from 'node:test';
import assert from 'node:assert/strict';
import { createGradientText, MAX_GRADIENT_CHARACTERS } from '../src/shared/tools/gradient.js';

test('gradient gives exact endpoints, rounded midpoint and stable single-character color', () => {
  const result = createGradientText('中文!', '#000000', '#FFFFFF');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.characters, [{ text: '中', color: '#000000' }, { text: '文', color: '#808080' }, { text: '!', color: '#ffffff' }]);
  const single = createGradientText('中', '#AbCdEf', '#000000');
  assert.ok(single.ok); if (single.ok) assert.equal(single.characters[0]?.color, '#abcdef');
});

test('joined emoji, skin tone and combining marks remain intact in preview and JSON', () => {
  const text = '👨‍👩‍👧‍👦👍🏽e\u0301'; const result = createGradientText(text, '#ff0000', '#0000ff');
  assert.ok(result.ok); if (!result.ok) return;
  assert.equal(result.characters.length, 3);
  assert.deepEqual(result.characters.map(item => item.text), ['👨‍👩‍👧‍👦', '👍🏽', 'e\u0301']);
  assert.equal(result.characters.map(item => item.text).join(''), text);
});

test('JSON output escapes quotes, newlines and backslashes without creating executable content', () => {
  const text = '"\\\n<script>中</script>'; const result = createGradientText(text, '#123456', '#654321');
  assert.ok(result.ok); if (!result.ok) return;
  const parsed: unknown = JSON.parse(result.json);
  assert.deepEqual(parsed, { text: '', extra: result.characters });
  assert.equal(result.characters.map(item => item.text).join(''), text);
  assert.equal(result.json.includes('\n'), false);
});

test('bounded input rejects empty text, invalid colors, controls and oversized grapheme or code-unit input', () => {
  assert.deepEqual(createGradientText('', '#000000', '#ffffff'), { ok: false, error: 'empty' });
  for (const color of ['#fff', 'red', '#GG0000', '#000000;', '000000']) {
    assert.deepEqual(createGradientText('A', color, '#ffffff'), { ok: false, error: 'invalidColor' });
    assert.deepEqual(createGradientText('A', '#ffffff', color), { ok: false, error: 'invalidColor' });
  }
  assert.deepEqual(createGradientText('A\u0000', '#000000', '#ffffff'), { ok: false, error: 'invalidText' });
  assert.deepEqual(createGradientText('A'.repeat(MAX_GRADIENT_CHARACTERS + 1), '#000000', '#ffffff'), { ok: false, error: 'tooLong' });
  assert.deepEqual(createGradientText('a' + '\u0301'.repeat(4096), '#000000', '#ffffff'), { ok: false, error: 'tooLong' });
  assert.equal(createGradientText('👍🏽'.repeat(MAX_GRADIENT_CHARACTERS), '#000000', '#ffffff').ok, true);
});
