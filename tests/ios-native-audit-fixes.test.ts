import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(__dirname, '..');
const moduleRoot = resolve(projectRoot, 'modules', 'hermes-ios-context');
const readModule = (file: string): string => readFileSync(resolve(moduleRoot, file), 'utf8');
const readControls = (file: string): string =>
  readFileSync(resolve(projectRoot, 'modules', 'hermes-ios-controls', 'ios', file), 'utf8');
const readLiveBlur = (file: string): string =>
  readFileSync(resolve(projectRoot, 'modules', 'hermes-live-blur', 'ios', file), 'utf8');

// 1. HermesAppIntents.perform() must be @MainActor for any intent that
//    dispatches to HermesVoiceService.startAgentCapture or to the device
//    snapshot / location collectors, which are themselves @MainActor.
test('UI-touching AppIntent perform() bodies are isolated to the main actor', () => {
  const intents = readModule('ios/HermesAppIntents.swift');
  for (const intent of [
    'HermesVoiceCaptureIntent',
    'HermesRefreshContextIntent',
    'HermesCurrentLocationIntent',
  ]) {
    const pattern = new RegExp(
      'struct ' + intent + ': AppIntent[\\s\\S]{0,500}@MainActor[\\s\\S]{0,40}func perform\\(\\)',
      'm',
    );
    assert.match(intents, pattern, intent + ' perform() must be @MainActor');
  }
});

// 2. HermesLocationService is documented by Apple as main-actor-isolated.
test('HermesLocationService is annotated @MainActor', () => {
  const location = readModule('ios/HermesLocationService.swift');
  assert.match(
    location,
    /@MainActor[\s\n]+final class HermesLocationService/,
    'HermesLocationService must be @MainActor',
  );
});

// 3. HermesMotionService and HermesDeviceService are main-thread-only APIs.
test('HermesMotionService and HermesDeviceService are @MainActor', () => {
  const motion = readModule('ios/HermesMotionService.swift');
  const device = readModule('ios/HermesDeviceService.swift');
  assert.match(
    motion,
    /@MainActor[\s\n]+final class HermesMotionService/,
    'HermesMotionService must be @MainActor',
  );
  assert.match(
    device,
    /@MainActor[\s\n]+final class HermesDeviceService/,
    'HermesDeviceService must be @MainActor',
  );
});

// 4. HermesBrowserService.jsString must use JSONEncoder (not
//    JSONSerialization.data(withJSONObject:)) so that selector and text
//    values produce a valid JS string literal. The old implementation
//    silently returned the empty literal for every input.
test('HermesBrowserService encodes JS strings via JSONEncoder', () => {
  const browser = readModule('ios/HermesBrowserService.swift');
  assert.match(
    browser,
    /let encoder = JSONEncoder\(\)[\s\S]{0,200}try\? encoder\.encode\(value\)/,
    'jsString must JSONEncoder-encode the value',
  );
  assert.doesNotMatch(
    browser,
    /jsString\([\s\S]{0,40}JSONSerialization\.data\(withJSONObject: value\)/,
    'jsString must not call JSONSerialization.data(withJSONObject:) on a bare String',
  );
});

// 5. HermesPhotosService used isSynchronous + a captured var to "synchronously"
//    fetch image data. The fix wraps the request in withCheckedThrowingContinuation.
test('PHImageManager calls use a checked continuation and never isSynchronous', () => {
  const services = readModule('ios/HermesNativeActionServices.swift');
  assert.doesNotMatch(
    services,
    /options\.isSynchronous = true/,
    'HermesPhotosService must not request isSynchronous delivery',
  );
  // All three call sites must wrap the request in a continuation.
  const matched = (services.match(
    /withCheckedThrowingContinuation \{ continuation in\s*var resumed = false\s*PHImageManager\.default\(\)\.requestImageDataAndOrientation/g,
  ) ?? []).length;
  assert.ok(
    matched >= 3,
    'expected at least 3 sites to use continuation-wrapped PHImageManager calls, found ' + matched,
  );
});

// 6. HermesPressFeedbackView and HermesSelectionView animator retain cycles
//    are broken: the animations block must not capture self directly.
test('UIKit animator retain cycles are broken in the control views', () => {
  const press = readControls('HermesPressFeedbackModule.swift');
  const select = readControls('HermesSelectionModule.swift');
  assert.match(
    press,
    /UIViewPropertyAnimator\([\s\S]{0,80}\) \{[\s\S]{0,20}self\.alpha = targetAlpha[\s\S]{0,80}self\.transform = targetTransform/,
    'press animations block must use captured values, not self properties',
  );
  assert.doesNotMatch(
    press,
    /let changes = \{[\s\S]{0,80}self\.alpha = pressed \?/,
    'press animations block must not capture self',
  );
  assert.match(
    select,
    /let targetBackground: UIColor = \.hermes\(selected \? selectedBackground : unselectedBackground\)/,
    'selection must pre-compute targetBackground',
  );
  assert.doesNotMatch(
    select,
    /let changes = \{[\s\S]{0,80}self\.backgroundColor = \.hermes\(\s*self\.selected/,
    'selection animations block must not capture self',
  );
});

// 7. HermesLiquidGlassView had the same retain cycle pattern.
test('HermesLiquidGlassView animations block does not capture self directly', () => {
  const blur = readLiveBlur('HermesLiquidGlassView.swift');
  assert.match(
    blur,
    /let tintAlpha: CGFloat = active \? 1\.18 : 1/,
    'glass must pre-compute tintAlpha',
  );
  assert.match(
    blur,
    /UIViewPropertyAnimator\([\s\S]{0,200}\) \{ \[weak self\] in[\s\S]{0,200}self\.tintView\.alpha = tintAlpha/,
    'glass animations block must use [weak self] and captured values',
  );
});

// 8. HermesNFCService deinit invalidates the reader session.
test('HermesNFCService invalidates its reader session on deinit', () => {
  const services = readModule('ios/HermesNativeActionServices.swift');
  // The class header is followed by a multi-line doc comment that explains
  // the lifecycle, so allow up to 1500 chars between the class declaration
  // and the deinit body.
  assert.match(
    services,
    /final class HermesNFCService[\s\S]{0,1500}deinit \{\s*session\?\.invalidate\(\)/,
    'HermesNFCService must invalidate its reader session in deinit',
  );
});

// 9. executeBrowserForCommand bridges to a HermesBrowserService method that
//    is @MainActor. The hop is required for WKWebView correctness.
test('executeBrowserForCommand hops to the main actor', () => {
  const module = readModule('ios/HermesIOSContextModule.swift');
  // HermesIOSContextModule is large; widen the lookahead so the test
  // does not couple to unrelated definitions between the AsyncFunction
  // and the MainActor.run block.
  assert.match(
    module,
    /AsyncFunction\("executeBrowserForCommand"[\s\S]{0,2500}MainActor\.run[\s\S]{0,400}HermesBrowserService\.shared\.execute/,
    'executeBrowserForCommand must wrap HermesBrowserService.execute in MainActor.run',
  );
});

// 10. HermesAppIntents must register HermesSendPromptIntent and
//     HermesQuickTaskIntent via HermesTaskShortcuts.
test('HermesTaskShortcuts surfaces every UI-touching shortcut', () => {
  const intents = readModule('ios/HermesAppIntents.swift');
  assert.match(
    intents,
    /AppShortcut\(\s*intent: HermesSendPromptIntent\(\), phrases:/,
    'HermesSendPromptIntent must be exposed via HermesTaskShortcuts',
  );
  assert.match(
    intents,
    /AppShortcut\(\s*intent: HermesQuickTaskIntent\(\), phrases:/,
    'HermesQuickTaskIntent must be exposed via HermesTaskShortcuts',
  );
});

// 11. The Hermes NFC service keeps its session strongly referenced by the
//     reader. Documenting the lifecycle helps future refactors.
test('HermesNFCService session lifecycle is documented', () => {
  const services = readModule('ios/HermesNativeActionServices.swift');
  // The doc comment immediately preceding the deinit must mention the
  // delegate retention behavior. Allow generous whitespace between the
  // tokens so line wrapping or comment refactors do not break the test.
  assert.match(
    services,
    /NFCNDEFReaderSession[\s\S]{0,200}retains its delegate[\s\S]{0,500}force-killed the extension/,
    'NFC service must document the session/delegate retention behavior',
  );
});

// 12. HermesBrowserService.jsString now produces a real JSON string literal,
//     not a JSONObject serialization attempt.
test('HermesBrowserService.jsString handles embedded quotes and backslashes', () => {
  const browser = readModule('ios/HermesBrowserService.swift');
  // The new implementation uses JSONEncoder withoutEscapingSlashes which
  // produces a properly-quoted JS string literal. The old implementation
  // used JSONSerialization.data(withJSONObject:) on a String, which is
  // not a JSONObject root, so every selector was the empty literal "".
  assert.match(
    browser,
    /encoder\.outputFormatting = \[\.withoutEscapingSlashes\]/,
    'jsString must produce a literal with .withoutEscapingSlashes so JS-side escape sequences are preserved',
  );
});

// 13. The HermesPressFeedbackView animator's completion handler clears the
//     self.animator slot only when the slot still references this animator.
test('HermesPressFeedbackView animator completion clears the slot safely', () => {
  const press = readControls('HermesPressFeedbackModule.swift');
  assert.match(
    press,
    /animator\.addCompletion \{ \[weak self\] _ in[\s\S]{0,200}guard self\?\.animator === animator else \{ return \}[\s\S]{0,100}self\?\.animator = nil/,
    'press must guard the slot check with weak self and identity compare',
  );
});

// 14. HermesWatchService.send wraps the WatchConnectivity sendMessage in a
//     single-shot box so a reply + error double-callback (a known WCSession
//     race documented since watchOS 9) cannot resume the continuation twice.
test('HermesWatchService guards sendMessage continuation against double-resume', () => {
  const watch = readModule('ios/HermesWatchService.swift');
  assert.match(
    watch,
    /private final class HermesWatchOnceBox[\s\S]{0,400}func tryClaim\(\) -> Bool/,
    'HermesWatchService must define a one-shot continuation guard',
  );
  assert.match(
    watch,
    /session\.sendMessage[\s\S]{0,400}guard box\.tryClaim\(\) else \{ return \}[\s\S]{0,400}continuation\.resume/,
    'sendMessage replyHandler and errorHandler must guard the continuation with the box',
  );
});
