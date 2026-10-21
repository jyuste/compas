export type Window = { start: string; end: string };
export type DayRule = { enabled: boolean; entry: Window; exit: Window };
export type Period = { id: string; name: string; from: string; to: string; kind: 'off'|'schedule'; days?: DayRule[] };
export type Config = { paused: boolean; days: DayRule[]; periods: Period[] };
export const defaults = (): Config => ({paused:false, days:Array.from({length:7},(_,i)=>({enabled:i<5, entry:{start:'08:25',end:'08:36'},exit:{start:i===4?'14:55':'17:28',end:i===4?'15:03':'17:40'}})),periods:[]});
export function localDay(now: number) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function weekday(day:string) { return (new Date(day+'T12:00:00Z').getUTCDay()+6)%7; }
export function resolve(config:Config,day:string) {
 const matches=config.periods.filter(p=>p.from<=day&&p.to>=day);
 if(config.paused) return {reason:'Automatización pausada'};
 const off=matches.find(p=>p.kind==='off'); if(off) return {reason:off.name};
 const exact=matches.find(p=>p.kind==='schedule'&&p.from===p.to);
 const period=exact??matches.find(p=>p.kind==='schedule');
 const rule=(period?.days??config.days)[weekday(day)];
 return rule.enabled ? {rule,source:period?.name??'Horario habitual'} : {reason:'Día no laborable'};
}
export function instant(day:string,time:string,second=0) {
 const [h,m]=time.split(':').map(Number); const base=Date.parse(`${day}T${time}:00Z`);
 const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',hourCycle:'h23'}).format(base));
 const offset=(hour-h+24)%24; return base-offset*3600000+second*1000;
}
export function range(day:string,w:Window) { return {from:instant(day,w.start),to:instant(day,w.end,59)}; }
export function choose(from:number,to:number,random=Math.random) { return from+Math.floor(random()*(Math.floor((to-from)/1000)+1))*1000; }
export function validate(value:unknown):Config {
 const c=value as Config; const date=(s:unknown):s is string=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 const time=(s:unknown):s is string=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
 const days=(d:DayRule[])=>Array.isArray(d)&&d.length===7&&d.every(r=>r&&typeof r.enabled==='boolean'&&[r.entry,r.exit].every(w=>w&&time(w.start)&&time(w.end)&&w.start<=w.end)&&r.entry.end<r.exit.start);
 if(!c||typeof c.paused!=='boolean'||!days(c.days)||!Array.isArray(c.periods)||c.periods.length>200) throw Error('Configuración inválida. Revisa los horarios.');
 const ids=new Set();
 for(const p of c.periods){if(!p||typeof p.id!=='string'||!/^[\w-]{1,80}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||!date(p.from)||!date(p.to)||p.from>p.to||!['off','schedule'].includes(p.kind)||(p.kind==='schedule'&&!days(p.days!)))throw Error('Periodo inválido.');ids.add(p.id);}
 const schedules=c.periods.filter(p=>p.kind==='schedule'&&p.from!==p.to);
 for(let i=0;i<schedules.length;i++)for(let j=i+1;j<schedules.length;j++)if(schedules[i].from<=schedules[j].to&&schedules[j].from<=schedules[i].to)throw Error('Los periodos de horario especial no pueden solaparse.');
 const exact=c.periods.filter(p=>p.kind==='schedule'&&p.from===p.to);if(new Set(exact.map(p=>p.from)).size!==exact.length)throw Error('Solo se permite una excepción horaria por día.');
 return {paused:c.paused,days:c.days,periods:c.periods};
}
