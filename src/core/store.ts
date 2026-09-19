export type Listener<T> = (state: T) => void;
export type Unsubscribe = () => void;

export class Store<T> {
  private state: T;
  private listeners: Set<Listener<T>> = new Set();

  constructor(initialState: T) {
    this.state = initialState;
  }

  get(): T {
    return this.state;
  }

  set(partialOrNext: Partial<T> | ((prev: T) => Partial<T> | T)): void {
    const nextState =
      typeof partialOrNext === 'function'
        ? { ...this.state, ...(partialOrNext as (prev: T) => Partial<T> | T)(this.state) }
        : { ...this.state, ...partialOrNext };

    this.state = nextState;
    this.notify();
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  select<K>(
    selector: (state: T) => K,
    listener: (val: K) => void,
    isEqual: (a: K, b: K) => boolean = Object.is
  ): Unsubscribe {
    let currentVal = selector(this.state);
    listener(currentVal);

    return this.subscribe((nextState) => {
      const nextVal = selector(nextState);
      if (!isEqual(currentVal, nextVal)) {
        currentVal = nextVal;
        listener(currentVal);
      }
    });
  }

  private notify(): void {
    const snapshot = Array.from(this.listeners);
    for (const listener of snapshot) {
      if (this.listeners.has(listener)) {
        try {
          listener(this.state);
        } catch (err) {
          console.error('Store listener error:', err);
        }
      }
    }
  }
}
