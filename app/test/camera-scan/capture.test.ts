// Preparing a photo in the browser (contracts 4): accepted types, the 5 MB limit, and the scan screen's
// controls and wording (CS-1, CS-8, CS-9, K2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientModule } from '../helpers/client.ts';
import { readPublic } from '../helpers/css.ts';
import { PNG_BYTES, PNG_DATA_URL } from '../helpers/images.ts';

const { ACCEPTED_TYPES, MAX_BYTES, dataUrlBytes, canSendAsIs, scaleSize } = await clientModule('features/camera-scan/capture.js');
const screens = readPublic('features/camera-scan/screens.js');

test('accepted photo types and the size limit match the server', () => {
  assert.deepEqual(ACCEPTED_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(MAX_BYTES, 5 * 1024 * 1024);
});

test('decoded size is read from a data URL', () => {
  assert.equal(dataUrlBytes(PNG_DATA_URL), PNG_BYTES.length);
  assert.equal(dataUrlBytes('data:image/png;base64,QUJD'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,QUI='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,QQ=='), 1);
  assert.equal(dataUrlBytes('no comma'), 0);
});

test('a photo of an accepted type under the limit is sent exactly as it is', () => {
  assert.equal(canSendAsIs({ type: 'image/jpeg', size: 1000 }), true);
  assert.equal(canSendAsIs({ type: 'image/webp', size: MAX_BYTES }), true);
  assert.equal(canSendAsIs({ type: 'image/jpeg', size: MAX_BYTES + 1 }), false);
  assert.equal(canSendAsIs({ type: 'image/heic', size: 1000 }), false);
  assert.equal(canSendAsIs({ type: 'image/png', size: 0 }), false);
  assert.equal(canSendAsIs(null), false);
});

test('re-encoding keeps the shape and never enlarges', () => {
  assert.deepEqual(scaleSize(4000, 3000, 2000), { width: 2000, height: 1500 });
  assert.deepEqual(scaleSize(3000, 4000, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(scaleSize(800, 600, 2000), { width: 800, height: 600 });
  assert.deepEqual(scaleSize(0, 0, 2000), { width: 0, height: 0 });
});

test('the scan screen has every control the PRD lists (CS-1)', () => {
  for (const control of ["'Identify'", "'Photos'", "'Snap Tips'", "'aria-label': 'Close'", "'aria-label': 'Flash'", "'aria-label': 'Flip camera'"]) assert.ok(screens.includes(control), control);
  assert.match(screens, /type: 'file'/);
  assert.match(screens, /accept: ACCEPTED_TYPES\.join\(','\)/);
});

test('the confirm wording is the approved one, with Yes and Edit (K2)', () => {
  assert.ok(screens.includes('`We think this is: ${label}. Is that right?`'));
  assert.match(screens, /'Yes',/);
  assert.match(screens, /'Edit',/);
  assert.doesNotMatch(screens, /Is this a /);
});

test('a denied or missing camera falls back to photo upload (CS-9)', () => {
  assert.match(screens, /catch \{[\s\S]{0,200}showUploadOnly\(\)/);
  assert.match(screens, /The camera is not available here\. Choose a photo instead\./);
});

test('the photo is never put in browser storage, and only labels wait for confirmation (CS-10)', () => {
  for (const file of ['features/camera-scan/screens.js', 'features/camera-scan/capture.js']) {
    assert.doesNotMatch(readPublic(file), /localStorage|sessionStorage|indexedDB|caches\.|document\.cookie/, file);
  }
  assert.match(screens, /pending = \{\s*status: r\.status,\s*label:[^}]*candidates:/);
  assert.doesNotMatch(screens, /pending = \{[^}]*(image|dataUrl|photo)/i);
});

test('no screen in the scan feature shows a stream label or a verdict (CS-4)', () => {
  assert.doesNotMatch(screens, /Recycling|Compost|Garbage|Special drop-off|Deposit return|STREAM_LABELS|card-(blue|yellow|red)/);
});
