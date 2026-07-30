const WEB_PICKER_FOCUS_ABANDON_MS = 1_500;
const WEB_PICKER_MAX_WAIT_MS = 120_000;

export function subscribeToWebPickerAbandonment(abandon: () => void): () => void {
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let selectionObserved = false;
  const onChange = (event: Event) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      && target.type === 'file'
      && Boolean(target.files?.length)
    ) {
      selectionObserved = true;
    }
  };
  const onFocus = () => {
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if (!selectionObserved) abandon();
    }, WEB_PICKER_FOCUS_ABANDON_MS);
  };
  const maxWaitTimer = setTimeout(abandon, WEB_PICKER_MAX_WAIT_MS);
  document.addEventListener('change', onChange, true);
  window.addEventListener('focus', onFocus);
  return () => {
    document.removeEventListener('change', onChange, true);
    window.removeEventListener('focus', onFocus);
    if (focusTimer) clearTimeout(focusTimer);
    clearTimeout(maxWaitTimer);
  };
}
