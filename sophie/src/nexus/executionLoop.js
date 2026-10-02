'use strict';

const { verifyResponse } = require('./verification');

async function executeLoop({
  taskState = null,
  plan,
  execute,
  observe,
  verify,
  correct,
  maxIterations = 3,
  onStep = () => {}
} = {}) {
  if (typeof execute !== 'function') throw new Error('execute() is required.');

  const history = [];
  let state = { status: 'planned', plan };

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    onStep({ phase: 'EXECUTE', iteration });
    const result = await execute({ iteration, state, history });

    history.push({ phase: 'EXECUTE', iteration, result });
    state = { ...state, execution: result, status: 'executed', taskState: taskState ? { ...taskState, status: 'executed', iteration } : null };

    onStep({ phase: 'OBSERVE', iteration });
    const observation = typeof observe === 'function'
      ? await observe({ iteration, state, history })
      : result;

    history.push({ phase: 'OBSERVE', iteration, observation });
    state = { ...state, observation, status: 'observed', taskState: taskState ? { ...state.taskState, status: 'observed' } : state.taskState };

    onStep({ phase: 'VERIFY', iteration });
    const verification = typeof verify === 'function'
      ? await verify({ iteration, state, history })
      : verifyResponse({ text: observation?.text || observation, execution: result });

    history.push({ phase: 'VERIFY', iteration, verification });
    state = { ...state, verification, status: verification.ok ? 'verified' : 'verification_failed', taskState: taskState ? { ...state.taskState, status: verification.ok ? 'verified' : 'verification_failed' } : state.taskState };

    if (verification.ok) {
      return { ok: true, state, history, iterations: iteration };
    }

    if (typeof correct !== 'function' || iteration === maxIterations) break;

    onStep({ phase: 'CORRECT', iteration });
    const correction = await correct({ iteration, state, history });
    history.push({ phase: 'CORRECT', iteration, correction });
    state = { ...state, correction, status: 'correcting' };
  }

  return { ok: false, state, history, iterations: maxIterations };
}

module.exports = { executeLoop };
