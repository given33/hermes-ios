import assert from 'node:assert/strict';
import test from 'node:test';

import {
  httpStatus,
  smartWeatherLoadErrorMessage,
  smartWeatherRetryDelayMs,
} from '../src/context/smart-weather-load';

test('smart weather replaces gateway documents with localized actionable status', () => {
  const error = Object.assign(
    new Error('Hermes authentication failed (429): <html><h1>nginx</h1></html>'),
    { status: 429 },
  );
  const message = smartWeatherLoadErrorMessage(error, 'zh');

  assert.equal(message, '服务器请求过于频繁，智能天气将稍后自动重试。');
  assert.doesNotMatch(message, /html|nginx/i);
  assert.equal(smartWeatherRetryDelayMs(error), 60_000);
  assert.equal(httpStatus(error), 429);
});

test('smart weather keeps the native map available on upstream outages', () => {
  const error = Object.assign(new Error('Hermes request failed (502)'), { status: 502 });
  assert.match(smartWeatherLoadErrorMessage(error, 'zh'), /地图和本机定位仍可继续使用/);
  assert.equal(smartWeatherRetryDelayMs(error), 30_000);
});

test('smart weather bounds plain transport errors and drops untyped HTML', () => {
  assert.equal(
    smartWeatherLoadErrorMessage(new Error('<!doctype html><title>failure</title>'), 'en'),
    'Smart Weather data is temporarily unavailable. Try again shortly.',
  );
  assert.equal(smartWeatherLoadErrorMessage(new Error('network offline'), 'en'), 'network offline');
});
