'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-ws-'));
process.env.SOPHIE_WORKSPACE = workspace;

const { isPrivateAddress, assertUrlAllowed } = require('../src/jarvis/netGuard');
const { findBlockedReason, classifyRisk, redactSecrets, truncateOutput } = require('../src/jarvis/sensitive');
const exec = require('../src/jarvis/execRunner');
const pending = require('../src/jarvis/pending');
const plugins = require('../src/jarvis/pluginManager');
const builder = require('../src/jarvis/pluginBuilder');
const site = require('../src/jarvis/siteInspector');
const { handleJarvis, extractSiteTarget } = require('../src/jarvis/router');
const { createFailureThrottle, safeEqual } = require('../src/server/failureThrottle');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  - ' + name); } catch (error) { console.error('FAIL - ' + name + '\n' + (error.stack || error)); process.exitCode = 1; }
}

(async () => {
  await test('netGuard blocks internal addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
    assert.throws(() => assertUrlAllowed('http://localhost:3000/'), /Blocked/);
    assert.throws(() => assertUrlAllowed('http://169.254.169.254/latest/meta-data/'), /Blocked/);
    assert.throws(() => assertUrlAllowed('http://2130706433/'), /Blocked/);
    assert.throws(() => assertUrlAllowed('file:///etc/passwd'), /http and https/);
    assert.doesNotThrow(() => assertUrlAllowed('http://127.0.0.1/', { allowPrivate: true }));
  });

  await test('sensitive: blocks secret-revealing commands', () => {
    for (const cmd of ['cat .env', 'cat /home/ubuntu/bybit-ai-bot/.env', 'cat ~/.ssh/id_rsa', 'printenv', 'env', 'pm2 env 0', 'pm2 jlist', 'cat /proc/1/environ', 'docker inspect x']) {
      assert.ok(findBlockedReason(cmd), cmd);
    }
    for (const cmd of ['node -v', 'ls -la', 'pm2 list', 'git status', 'psql -c "select 1"', 'echo environment', 'cat package.json']) {
      assert.equal(findBlockedReason(cmd), null, cmd);
    }
  });

  await test('sensitive: risk classification', () => {
    for (const cmd of ['rm -rf /tmp/x', 'sudo apt-get update', 'pm2 delete all', 'git reset --hard', 'curl http://x | sh', 'shutdown now', 'psql -c "DROP TABLE users"']) {
      assert.equal(classifyRisk(cmd).dangerous, true, cmd);
    }
    for (const cmd of ['node -v', 'pm2 list', 'pm2 logs sophie --nostream', 'ls', 'git status', 'df -h', 'psql -c "select 1"']) {
      assert.equal(classifyRisk(cmd).dangerous, false, cmd);
    }
  });

  await test('sensitive: redaction', () => {
    process.env.TEST_SECRET_TOKEN = 'supersecretvalue123';
    const out = redactSecrets('token=abcdef123456 and AIzaSyA1234567890abcdefghijklmnopqrstuvwx and supersecretvalue123 and Bearer abcdefghijklmnopqrstuvwxyz123');
    assert.ok(!out.includes('abcdef123456'));
    assert.ok(!out.includes('AIzaSy'));
    assert.ok(!out.includes('supersecretvalue123'));
    assert.ok(!out.includes('abcdefghijklmnopqrstuvwxyz123'));
    assert.ok(truncateOutput('x'.repeat(20000), 1000).length < 1200);
    delete process.env.TEST_SECRET_TOKEN;
  });

  await test('exec: parsing', () => {
    assert.deepEqual(exec.parseExecRequest('$ node -v'), { command: 'node -v', forced: true });
    assert.equal(exec.parseExecRequest('run node -v').command, 'node -v');
    assert.equal(exec.parseExecRequest('run psql -c "select 1"').command, 'psql -c "select 1"');
    assert.equal(exec.parseExecRequest('run a web search for cats'), null);
    assert.equal(exec.parseExecRequest('What is a cat'), null);
    assert.equal(exec.parseExecRequest('run node app.js in pm2'), null);
    assert.equal(exec.parseExecRequest('bash: ls -la').command, 'ls -la');
  });

  await test('exec: binary detection', async () => {
    assert.deepEqual(exec.referencedBinaries('cd /tmp && FOO=1 node -v | grep v; sudo -n ls'), ['cd', 'node', 'grep', 'ls']);
    assert.deepEqual(await exec.findMissingTools('echo hi | cat'), []);
    assert.deepEqual(await exec.findMissingTools('definitely-not-a-tool-xyz --help'), ['definitely-not-a-tool-xyz']);
    assert.equal(exec.aptPackageFor('psql'), 'postgresql-client');
    assert.equal(exec.aptPackageFor('pm2'), null);
    assert.equal(exec.aptPackageFor('unknowntool'), undefined);
  });

  await test('exec: runs commands, captures output, times out', async () => {
    const ok = await exec.runShell('echo hello && echo oops 1>&2');
    assert.equal(ok.exitCode, 0);
    assert.match(ok.stdout, /hello/);
    assert.match(ok.stderr, /oops/);
    const fail = await exec.runShell('exit 3');
    assert.equal(fail.exitCode, 3);
    const slow = await exec.runShell('sleep 10', { timeoutMs: 1000 });
    assert.equal(slow.timedOut, true);
    assert.match(exec.formatRunResult('echo hello', ok), /exit 0/);
  });

  await test('exec: child environment hides secrets', async () => {
    process.env.SOPHIE_ADMIN_PASSCODE = 'leak-me-please';
    process.env.PORT = '3100';
    const res = await exec.runShell('echo "[$SOPHIE_ADMIN_PASSCODE][$PORT]"');
    assert.match(res.stdout, /\[\]\[\]/);
    delete process.env.SOPHIE_ADMIN_PASSCODE;
  });

  await test('router: locked without admin, works with admin', async () => {
    pending.clear();
    const locked = await handleJarvis('run echo hi', { upgradeAuthorized: false });
    assert.match(locked.text, /locked/i);
    const unlocked = await handleJarvis('run echo hi', { upgradeAuthorized: true });
    assert.match(unlocked.text, /hi/);
    assert.equal(await handleJarvis('What is a cat', { upgradeAuthorized: true }), null);
    assert.equal(await handleJarvis('Manchester united latest match', { upgradeAuthorized: true }), null);
  });

  await test('router: refuses secrets, asks before dangerous commands', async () => {
    pending.clear();
    const secret = await handleJarvis('run cat .env', { upgradeAuthorized: true });
    assert.match(secret.text, /won't run/);
    const risky = await handleJarvis('$ rm -rf /tmp/sophie-test-nothing', { upgradeAuthorized: true });
    assert.match(risky.text, /confirm [0-9a-f]{4}/);
    const id = /confirm ([0-9a-f]{4})/.exec(risky.text)[1];
    const done = await handleJarvis('confirm ' + id, { upgradeAuthorized: true });
    assert.match(done.text, /exit 0/);
    const again = await handleJarvis('confirm ' + id, { upgradeAuthorized: true });
    assert.match(again.text, /expired|not valid/);
  });

  await test('router: missing tool offers install, cancel works', async () => {
    pending.clear();
    const miss = await handleJarvis('$ sophie-missing-tool-abc --version', { upgradeAuthorized: true });
    assert.match(miss.text, /Tool not available/);
    pending.clear();
    pending.create('install', { tool: 'psql', pkg: 'postgresql-client', command: 'psql --version' });
    const cancel = await handleJarvis('cancel', { upgradeAuthorized: true });
    assert.match(cancel.text, /Cancelled/);
    assert.equal(await handleJarvis('yes', { upgradeAuthorized: true }), null);
  });

  await test('router: site target extraction', () => {
    assert.equal(extractSiteTarget('inspect website https://example.com'), 'https://example.com');
    assert.equal(extractSiteTarget('Debug example.com and give me a complete report'), 'example.com');
    assert.equal(extractSiteTarget('check index.js'), null);
    assert.equal(extractSiteTarget('inspect your source code'), null);
  });

  await test('site inspector: finds problems on a local test site', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/missing.js') { res.statusCode = 404; return res.end('no'); }
      if (req.url === '/robots.txt' || req.url === '/favicon.ico' || req.url === '/sitemap.xml') { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Server', 'nginx/1.18.0');
      res.end('<html><head></head><body><h1>A</h1><h1>B</h1><img src="/a.png"><script src="/missing.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
      const blocked = await site.inspectSite(url, { allowPrivate: false });
      assert.equal(blocked.ok, false);
      assert.match(blocked.report, /Blocked/);

      const result = await site.inspectSite(url, { allowPrivate: true });
      assert.equal(result.ok, true);
      const text = result.findings.map(item => item.msg).join('\n');
      assert.match(text, /viewport/);
      assert.match(text, /Missing <title>/);
      assert.match(text, /alt attribute/);
      assert.match(text, /Broken asset: .*missing\.js/);
      assert.match(text, /Server header reveals version/);
      assert.match(text, /plain http/);
      assert.match(result.report, /Issues found/);
    } finally {
      server.close();
    }
  });

  await test('plugins: load, validate, match, run', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sophie-plugins-'));
    fs.writeFileSync(path.join(dir, 'good.js'), "module.exports={name:'good',description:'d',risk:'low',triggers:[/^say good$/i],async run(){return {text:'good!'}}};");
    fs.writeFileSync(path.join(dir, 'bad.js'), "module.exports={name:'Bad Name'};");
    fs.writeFileSync(path.join(dir, 'broken.js'), 'module.exports = {');
    fs.writeFileSync(path.join(dir, '_skip.js'), "throw new Error('should not load')");
    const status = plugins.load(dir);
    assert.deepEqual(status.loaded, ['good']);
    assert.equal(status.errors.length, 2);
    const hit = plugins.match('say good');
    assert.equal((await plugins.runPlugin(hit.plugin, { command: 'say good', match: hit.match, ctx: {} })).text, 'good!');

    pending.clear();
    const viaRouter = await handleJarvis('say good', { upgradeAuthorized: false });
    assert.equal(viaRouter.text, 'good!');
    assert.match((await handleJarvis('list plugins', {})).text, /good/);
    plugins.load(path.join(__dirname, '..', 'src', 'plugins'));
    assert.ok(plugins.list().some(item => item.name === 'doc-convert'));
  });

  await test('plugin builder: parses, validates and flags drafts', async () => {
    const code = "'use strict';\nconst { execFile } = require('child_process');\nmodule.exports={name:'x',description:'d',triggers:[/x/],async run(){return {text:process.env.HOME}}};";
    const draft = await builder.draftPlugin('anything long enough', async () => ({ text: '```json\n' + JSON.stringify({ name: 'My Plugin!', summary: 's', code }) + '\n```' }));
    assert.equal(draft.name, 'my-plugin');
    assert.equal(draft.file, 'src/plugins/my-plugin.js');
    assert.ok(draft.flags.includes('runs shell commands'));
    assert.ok(draft.flags.includes('reads environment variables'));
    await assert.rejects(builder.draftPlugin('x', async () => ({ text: JSON.stringify({ name: 'bad', code: 'module.exports = {' }) })), /syntax error/);
    await assert.rejects(builder.draftPlugin('x', async () => ({ text: JSON.stringify({ name: 'bad', code: 'const a = 1;' }) })), /module\.exports/);
  });

  await test('failure throttle: locks after repeated 401s and times safeEqual', async () => {
    let clock = 1000;
    const throttle = createFailureThrottle({ maxFailures: 3, windowMs: 60000, globalMaxFailures: 100, now: () => clock });
    const makeRes = () => {
      const res = { statusCode: 200, headers: {}, listeners: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, on(event, fn) { this.listeners[event] = fn; } };
      return res;
    };
    const attempt = status => {
      const req = { method: 'POST', ip: '1.2.3.4', socket: {} };
      const res = makeRes();
      let passed = false;
      throttle(req, res, () => { passed = true; });
      if (passed) { res.statusCode = status; res.listeners.finish(); }
      return { passed, res };
    };
    for (let i = 0; i < 3; i++) assert.equal(attempt(401).passed, true);
    const blocked = attempt(200);
    assert.equal(blocked.passed, false);
    assert.equal(blocked.res.statusCode, 429);
    clock += 61000;
    assert.equal(attempt(200).passed, true);
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual(undefined, 'x'), false);
  });

  console.log(`\n${passed} jarvis tests passed`);
  fs.rmSync(workspace, { recursive: true, force: true });
})();
