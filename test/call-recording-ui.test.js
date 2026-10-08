'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appPath = path.join(__dirname, '..', 'public', 'app.js');
const stylesPath = path.join(__dirname, '..', 'public', 'styles.css');
const source = fs.readFileSync(appPath, 'utf8');
const styles = fs.readFileSync(stylesPath, 'utf8');
const start = source.indexOf("const CALL_RECORDING_FIELD = 'Voice_Recording__s';");
const end = source.indexOf('const lookupId =', start);
assert.ok(start >= 0 && end > start, 'Call-recording helper source was not found.');
const helperSource = `${source.slice(start, end)}\nglobalThis.__recording = { validatedCallRecordingUrl, isCallRecordingField, callRecordingLabel };`;
const sandbox = { URL };
vm.runInNewContext(helperSource, sandbox);
const { validatedCallRecordingUrl, isCallRecordingField, callRecordingLabel } = sandbox.__recording;

test('call recording validator accepts only the exact HTTPS Zoho PhoneBridge recording location', () => {
  assert.equal(
    validatedCallRecordingUrl('https://phonebridge.zoho.in/phonebridge/recording?recording_id=abc123'),
    'https://phonebridge.zoho.in/phonebridge/recording?recording_id=abc123',
  );
  assert.equal(
    validatedCallRecordingUrl('https://phonebridge.zoho.in/phonebridge/recording/archive/file.mp3?signature=opaque'),
    'https://phonebridge.zoho.in/phonebridge/recording/archive/file.mp3?signature=opaque',
  );

  const rejected = [
    'http://phonebridge.zoho.in/phonebridge/recording?id=1',
    'https://phonebridge.zoho.in.evil.example/phonebridge/recording?id=1',
    'https://sub.phonebridge.zoho.in/phonebridge/recording?id=1',
    'https://phonebridge.zoho.in:8443/phonebridge/recording?id=1',
    'https://user:password@phonebridge.zoho.in/phonebridge/recording?id=1',
    'https://phonebridge.zoho.in/phonebridge/recordings?id=1',
    'https://phonebridge.zoho.in/phonebridge/recording/../other?id=1',
    'https://phonebridge.zoho.in/phonebridge/recording?id=1#fragment',
    ' https://phonebridge.zoho.in/phonebridge/recording?id=1',
    'javascript:alert(1)',
    'not a url',
    '',
    null,
  ];
  rejected.forEach(value => assert.equal(validatedCallRecordingUrl(value), null, `Expected rejection for ${String(value)}`));
});

test('recording behavior is isolated to the exact Calls field and never exposes a URL as its label', () => {
  const valid = 'https://phonebridge.zoho.in/phonebridge/recording?id=1';
  assert.equal(isCallRecordingField('Calls', 'Voice_Recording__s'), true);
  assert.equal(isCallRecordingField('Deals', 'Voice_Recording__s'), false);
  assert.equal(isCallRecordingField('Calls', 'Website'), false);
  assert.equal(callRecordingLabel(valid), 'Recording available');
  assert.equal(callRecordingLabel('https://example.invalid/audio.mp3'), 'Recording unavailable');
});

test('call recording UI declares native accessible metadata-only playback and safe fallback links', () => {
  const segment = source.slice(start, end);
  assert.match(segment, /audio\.controls = true/);
  assert.match(segment, /audio\.preload = 'metadata'/);
  assert.match(segment, /aria-label', 'Call recording playback'/);
  assert.match(segment, /link\.target = '_blank'/);
  assert.match(segment, /link\.rel = 'noopener noreferrer'/);
  assert.match(segment, /link\.referrerPolicy = 'no-referrer'/);
  assert.doesNotMatch(segment, /innerHTML\s*=\s*url|textContent\s*=\s*url/);
  assert.match(styles, /\.call-recording-audio\s*\{/);
  assert.match(styles, /\.call-recording-open:focus-visible\s*\{/);
  assert.match(styles, /@media \(max-width: 820px\)[\s\S]*\.call-recording-audio\s*\{ width:100%; min-width:0; \}/);
});
