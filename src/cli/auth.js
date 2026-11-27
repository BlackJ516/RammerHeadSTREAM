#!/usr/bin/env node
// Administrator tool for accounts. Usage: npm run auth -- <command>
const readline = require('readline');
const config = require('../config');
const { AuthService, AuthError } = require('../auth/AuthService');
const pw = require('../auth/passwords');

const auth = new AuthService({
    dataDir: (config.auth || {}).dataDir,
    registration: (config.auth || {}).registration,
    bindingAddress: config.bindingAddress
});

function promptHidden(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl._writeToOutput = (s) => (s.includes(question) ? process.stdout.write(s) : null);
        rl.question(question, (answer) => {
            rl.close();
            process.stdout.write('\n');
            resolve(answer);
        });
    });
}

const usage = `Rammerhead Stream account tool

  npm run auth -- list                         list accounts
  npm run auth -- create-user <name>           create an account (prompts for a password)
  npm run auth -- set-password <name>          reset a user's password (signs them out everywhere)
  npm run auth -- disable <name> | enable <name>
  npm run auth -- delete <name>
  npm run auth -- invite [--uses 1] [--hours 72]   make a sign-up invite code (for registration: 'invite')
`;

(async () => {
    const [cmd, rawArg, ...rest] = process.argv.slice(2);
const arg = rawArg && cmd !== 'invite' ? pw.normalizeUsername(rawArg) : rawArg;
    const flag = (name, def) => {
        const all = [arg, ...rest];
        const i = all.indexOf('--' + name);
        return i >= 0 && all[i + 1] ? Number(all[i + 1]) : def;
    };
    switch (cmd) {
        case 'list':
            for (const u of auth.store.listUsers()) {
                console.log(`${u.name}\tcreated ${new Date(u.createdAt).toISOString()}${u.disabled ? '\tDISABLED' : ''}`);
            }
            console.log(`${auth.store.userCount()} account(s). sign-up mode: ${auth.registration}`);
            break;
        case 'create-user': {
            if (!arg || pw.validateUsername(arg)) throw new AuthError(400, pw.validateUsername(arg) || 'username required');
            const p1 = await promptHidden('Password: ');
            if (p1 !== (await promptHidden('Repeat password: '))) throw new AuthError(400, 'passwords do not match');
            const e = pw.validatePassword(p1, arg);
            if (e) throw new AuthError(400, e);
            const hash = await pw.hashPassword(p1);
            await auth.store.transaction((d) => {
                if (Object.prototype.hasOwnProperty.call(d.users, arg)) throw new AuthError(409, 'that username is taken');
                d.users[arg] = { pw: hash, createdAt: Date.now(), tokenVersion: 0, disabled: false };
            });
            console.log('created', arg);
            break;
        }
        case 'set-password': {
            const p1 = await promptHidden('New password: ');
            if (p1 !== (await promptHidden('Repeat password: '))) throw new AuthError(400, 'passwords do not match');
            await auth.adminSetPassword(arg, p1);
            console.log('password updated; all of the user\'s devices were signed out');
            break;
        }
        case 'disable':
            await auth.adminSetDisabled(arg, true);
            console.log('disabled', arg);
            break;
        case 'enable':
            await auth.adminSetDisabled(arg, false);
            console.log('enabled', arg);
            break;
        case 'delete':
            await auth.adminDelete(arg);
            console.log('deleted', arg);
            break;
        case 'invite': {
            const code = await auth.createInvite({ maxUses: flag('uses', 1), ttlHours: flag('hours', 72) });
            console.log('Invite code (shown once):', code);
            if (auth.registration !== 'invite') console.log(`note: sign-up mode is "${auth.registration}", set config.auth.registration = 'invite' to require codes`);
            break;
        }
        default:
            console.log(usage);
    }
})().catch((e) => {
    console.error('error:', e instanceof AuthError ? e.message : e);
    process.exit(1);
});
