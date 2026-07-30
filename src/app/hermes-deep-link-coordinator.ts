export interface HermesDeepLinkSubscription {
  remove(): void;
}

export interface HermesLinkingRuntime {
  addEventListener(
    type: 'url',
    listener: (event: { url: string }) => void,
  ): HermesDeepLinkSubscription;
  getInitialURL(): Promise<string | null>;
}

export function subscribeHermesDeepLinks(
  linking: HermesLinkingRuntime,
  accept: (url: string) => void,
): () => void {
  let active = true;
  let runtimeUrlReceived = false;
  const subscription = linking.addEventListener('url', ({ url }) => {
    runtimeUrlReceived = true;
    if (active) accept(url);
  });
  try {
    void linking.getInitialURL().then((url) => {
      if (active && !runtimeUrlReceived && url) accept(url);
    }).catch(() => undefined);
  } catch {
    // A broken native Linking bridge must not take down the authenticated root.
  }
  return () => {
    active = false;
    subscription.remove();
  };
}
