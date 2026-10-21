import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const env = { ...process.env };
// This machine also has Metech credentials in its global environment.
// Compás belongs to the Gmail account; select that profile explicitly.
for (const name of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL']) delete env[name];
const args=process.argv.slice(2);
if(!['whoami','auth','login','logout'].includes(args[0]))args.push('--profile','gmail-account');
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),...args],{env,stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(signal)process.kill(process.pid,signal);else process.exitCode=code??1;});
