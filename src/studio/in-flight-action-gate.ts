export interface InFlightActionGate {
  isLocked(): boolean;
  release(): void;
  tryAcquire(): boolean;
}

export function createInFlightActionGate(): InFlightActionGate {
  let locked = false;
  return {
    isLocked: () => locked,
    release: () => {
      locked = false;
    },
    tryAcquire: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
  };
}
