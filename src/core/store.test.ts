import { Store } from './store';

// Self-test store
const store = new Store({ count: 0, text: 'hello' });
let calls = 0;
let lastVal = 0;

const unsub = store.select((s) => s.count, (c) => {
  calls++;
  lastVal = c;
});

console.assert(calls === 1 && lastVal === 0, 'Initial select should fire immediately');

store.set({ text: 'world' });
console.assert(calls === 1, 'Select should not fire on unrelated property update');

store.set((s) => ({ count: s.count + 5 }));
console.assert(calls === 2 && lastVal === 5, 'Select should fire on count update');

unsub();
store.set({ count: 10 });
console.assert(calls === 2 && lastVal === 5, 'Unsubscribed listener must not fire');

// Self-test: listener mutating listeners set during dispatch
let nestedCallCount = 0;
const testStore = new Store({ value: 1 });
let unsubNested: (() => void) | null = null;
unsubNested = testStore.subscribe(() => {
  nestedCallCount++;
  if (unsubNested) unsubNested();
});
testStore.set({ value: 2 });
console.assert(nestedCallCount === 2, 'Unsubscribe during dispatch must not corrupt iteration');

// Self-test: store with settings persistence
const testStateStore = new Store({
  settings: {
    theme: 'dark',
    themeColor: 'mint',
    ambientSound: 'rain',
    ambientVolume: 0.6,
  },
});
testStateStore.set((prev) => ({
  settings: { ...prev.settings, themeColor: 'ocean' },
}));
console.assert(testStateStore.get().settings.themeColor === 'ocean', 'Settings themeColor must update');
console.assert(testStateStore.get().settings.theme === 'dark', 'Settings theme must not be lost');
console.assert(testStateStore.get().settings.ambientSound === 'rain', 'Ambient sound must be preserved');

console.log('Store self-check passed.');
