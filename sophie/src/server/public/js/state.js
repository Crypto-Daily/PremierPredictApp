'use strict';

const initial = {
  authenticated: false,
  activeThreadId: null,
  mode: 'GPT',
  command: {
    running: false,
    requestId: null,
    activity: '',
    status: 'idle'
  },
  ui: {
    menuOpen: false,
    inspectorOpen: false,
    busy: false
  }
};

let state = structuredClone(initial);
const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  state = {
    ...state,
    ...patch,
    command: patch.command ? { ...state.command, ...patch.command } : state.command,
    ui: patch.ui ? { ...state.ui, ...patch.ui } : state.ui
  };
  listeners.forEach(listener => listener(state));
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetState() {
  state = structuredClone(initial);
  listeners.forEach(listener => listener(state));
}
