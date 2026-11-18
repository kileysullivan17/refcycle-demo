// Display-time text swap (contracts 9; Q24, X-2, G12, G13).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientModule } from '../helpers/client.ts';

const { swapText, displayText, setSwapReporter } = await clientModule('shared/display-text.js');

test('every spelling of the county name becomes "Hawaiʻi County"', () => {
  for (const spelling of ['County of Hawaiʻi', 'County of Hawai‘i', 'County of Hawai’i', "County of Hawai'i", 'County of Hawai`i', 'County of Hawaii']) {
    const result = swapText(`${spelling}, HI`);
    assert.equal(result.text, 'Hawaiʻi County, HI', spelling);
    assert.deepEqual(result.swaps, [{ from: spelling, to: 'Hawaiʻi County', count: 1 }]);
  }
});

test('the business name from hc-oil-015 becomes its public description', () => {
  const result = swapText('Larger household quantities: Big Island Biodiesel accepts limited quantities (call first)');
  assert.equal(result.text, 'Larger household quantities: a local biodiesel company accepts limited quantities (call first)');
  assert.deepEqual(result.swaps, [{ from: 'Big Island Biodiesel', to: 'a local biodiesel company', count: 1 }]);
});

test('quoted source lines are left exactly as written', () => {
  const explanation = 'hc-system-000: “The County of Hawai`i currently does not have curbside rubbish.” Where: County of Hawaii stations';
  const result = swapText(explanation);
  assert.equal(result.text, 'hc-system-000: “The County of Hawai`i currently does not have curbside rubbish.” Where: Hawaiʻi County stations');
  assert.deepEqual(result.swaps, [{ from: 'County of Hawaii', to: 'Hawaiʻi County', count: 1 }]);
  assert.equal(swapText('“Big Island Biodiesel” and Big Island Biodiesel').text, '“Big Island Biodiesel” and a local biodiesel company');
});

test('an opening quote with no closing quote does not shield the text after it', () => {
  assert.equal(swapText('“unfinished Big Island Biodiesel').text, '“unfinished a local biodiesel company');
});

test('nothing else in a string changes', () => {
  for (const text of ['', 'Seattle, WA', 'Hawaiʻi County', 'the county of hawaii (lower case is not the name)', 'Hawaii County', '5¢ deposit: “quote” – dash … ellipsis']) {
    const result = swapText(text);
    assert.equal(result.text, text);
    assert.deepEqual(result.swaps, []);
  }
  assert.equal(swapText(null).text, '');
});

test('repeated matches are counted', () => {
  const result = swapText('County of Hawaii and County of Hawaii and County of Hawaiʻi');
  assert.equal(result.text, 'Hawaiʻi County and Hawaiʻi County and Hawaiʻi County');
  assert.deepEqual(result.swaps, [
    { from: 'County of Hawaii', to: 'Hawaiʻi County', count: 2 },
    { from: 'County of Hawaiʻi', to: 'Hawaiʻi County', count: 1 },
  ]);
});

test('displayText reports each call that replaced something, and a failing report never blocks display', () => {
  const seen: unknown[] = [];
  setSwapReporter((record: unknown) => seen.push(record));
  assert.equal(displayText('Seattle, WA', 'shell.place-name'), 'Seattle, WA');
  assert.equal(seen.length, 0);
  assert.equal(displayText('County of Hawaiʻi, HI', 'shell.place-name'), 'Hawaiʻi County, HI');
  assert.deepEqual(seen, [{ surface: 'shell.place-name', from: 'County of Hawaiʻi', to: 'Hawaiʻi County', count: 1 }]);
  setSwapReporter(() => {
    throw new Error('log down');
  });
  assert.equal(displayText('County of Hawaii', 'x'), 'Hawaiʻi County');
  setSwapReporter(null);
});
