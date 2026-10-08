'use strict';

const CommandProcessor = require('./commandProcessor');
const { handleJarvis } = require('../jarvis/router');
const { redactSecrets } = require('../jarvis/sensitive');

/*
 * Runs the Jarvis layer (server commands, website/server inspection, plugins, confirmations)
 * first. Anything it does not recognise falls through to the normal Sophie pipeline,
 * so existing behaviour (chat, research, Hermes delegation, self-inspect, threads) is unchanged.
 *
 * Messages containing the admin passcode are never examined here: they go straight to the
 * original processor, whose passcode guard blocks them before storage.
 */
class JarvisCommandProcessor extends CommandProcessor {
  async process(input, options = {}) {
    const command = typeof input === 'string' ? input.trim() : '';
    const passcode = process.env.SOPHIE_ADMIN_PASSCODE;

    if (command && !(passcode && command.includes(passcode))) {
      let result = null;

      try {
        result = await handleJarvis(command, {
          upgradeAuthorized: options.upgradeAuthorized === true,
          signal: options.signal
        });
      } catch (error) {
        console.error('[JARVIS] error:', error);
        result = {
          handled: true,
          text: '⚠️ Something went wrong in the Jarvis tools: ' + redactSecrets(error.message).slice(0, 300),
          artifacts: []
        };
      }

      if (result && result.handled) {
        const text = String(result.text || '');
        this.memory.addMessage('user', command);
        this.memory.addMessage('assistant', text.slice(0, 3000));
        return {
          type: 'response',
          text,
          artifacts: result.artifacts || [],
          mode: this.modeManager.getMode()
        };
      }
    }

    return super.process(input, options);
  }
}

module.exports = JarvisCommandProcessor;
