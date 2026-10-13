'use strict';

const REQUIRED_TEXT = ['overview', 'language', 'implementationPlan', 'testPlan'];
function validateBlueprint(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Blueprint must be an object.');
  for (const key of REQUIRED_TEXT) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('Blueprint field "' + key + '" is required.');
  }
  for (const key of ['modules', 'interfaces', 'risks', 'openQuestions']) {
    if (key === 'risks' || key === 'openQuestions') {
      if (input[key] !== undefined && (!Array.isArray(input[key]) || input[key].length > 100)) throw new Error(key + ' must be an array with at most 100 entries.');
    } else if (!Array.isArray(input[key]) || input[key].length > 100) {
      throw new Error(key + ' must be an array with at most 100 entries.');
    }
  }
  return true;
}
module.exports = { validateBlueprint };
