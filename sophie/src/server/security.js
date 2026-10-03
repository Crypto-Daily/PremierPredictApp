'use strict';
const crypto=require('node:crypto');
const WINDOW_MS=60*1000;
const MAX_REQUESTS=Math.max(10,Number(process.env.SOPHIE_RATE_LIMIT||60));
const MAX_ACTIVE=Math.max(1,Number(process.env.SOPHIE_MAX_CONCURRENT||4));
const SESSION_TTL_MS=Math.max(15*60*1000,Number(process.env.SOPHIE_SESSION_TTL_MS||8*60*60*1000));
const buckets=new Map(),sessions=new Map();
function clientKey(req){return String(req.ip||req.socket?.remoteAddress||'unknown')}
function checkRateLimit(req){const key=clientKey(req),now=Date.now();let b=buckets.get(key);if(!b||b.resetAt<=now)b={count:0,active:0,resetAt:now+WINDOW_MS};if(b.count>=MAX_REQUESTS)return{allowed:false,status:429,reason:'Rate limit exceeded.'};if(b.active>=MAX_ACTIVE)return{allowed:false,status:429,reason:'Too many concurrent Sophie requests.'};b.count++;b.active++;buckets.set(key,b);return{allowed:true,release:()=>{const c=buckets.get(key);if(c){c.active=Math.max(0,c.active-1);buckets.set(key,c)}}}}
function expectedToken(){return process.env.SOPHIE_API_TOKEN||''}
function accessPassword(){return process.env.SOPHIE_ACCESS_PASSWORD||''}
function timingSafeEqualText(a,b){const l=Buffer.from(String(a||'')),r=Buffer.from(String(b||''));return l.length===r.length&&crypto.timingSafeEqual(l,r)}
function getCookie(req,name){const h=req.headers.cookie||'';const p=h.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return p?decodeURIComponent(p.slice(name.length+1)):null}
function cleanupSessions(){const now=Date.now();for(const[k,v]of sessions)if(v.expiresAt<=now)sessions.delete(k)}
function createSession(){cleanupSessions();const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{expiresAt:Date.now()+SESSION_TTL_MS});return token}
function sessionValid(token){cleanupSessions();const s=token&&sessions.get(token);return Boolean(s&&s.expiresAt>Date.now())}
function revokeSession(token){if(token)sessions.delete(token)}
function credentialsConfigured(){return Boolean(expectedToken()||accessPassword())}
function authorize(req){const token=expectedToken();if(token){const header=String(req.headers.authorization||'');const supplied=header.startsWith('Bearer ')?header.slice(7).trim():'';if(timingSafeEqualText(supplied,token))return{allowed:true,method:'api_token'}}const cookie=getCookie(req,'sophie_access');if(sessionValid(cookie))return{allowed:true,method:'session'};if(!credentialsConfigured()&&process.env.NODE_ENV!=='production')return{allowed:true,method:'development'};return{allowed:false,reason:'Authentication required.'}}
function login(password){if(!accessPassword()||!timingSafeEqualText(password,accessPassword()))return null;return createSession()}
function sessionStatus(req){const required=credentialsConfigured()||process.env.NODE_ENV==='production';const authenticated=authorize(req).allowed;return{required,authenticated,methods:{password:Boolean(accessPassword()),apiToken:Boolean(expectedToken())},sessionTtlMs:SESSION_TTL_MS}}
function audit(event,details={}){const safe=JSON.stringify({at:new Date().toISOString(),event,...details});console.log('[NEXUS-AUDIT]',safe.slice(0,4000))}
module.exports={checkRateLimit,authorize,audit,login,revokeSession,sessionStatus,getCookie,SESSION_TTL_MS};