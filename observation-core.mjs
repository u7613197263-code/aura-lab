/**
 * AURA Market Evidence Integrity Core v1 — public research-only code.
 * Offline deterministic sampling contracts; no secrets, network calls, trades or persistence.
 */
import { createHash } from 'node:crypto';
export const HORIZONS = Object.freeze([
  { seconds: 300, label: '5m', toleranceMs: 120000 },
  { seconds: 900, label: '15m', toleranceMs: 300000 },
  { seconds: 3600, label: '1h', toleranceMs: 600000 },
  { seconds: 21600, label: '6h', toleranceMs: 1800000 },
  { seconds: 86400, label: '24h', toleranceMs: 3600000 }
]);
const hash = obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
export function makeDecision({chain,mint,pool,observedAt,decisionAt,rawEvidenceHash,modelVersion}){
  if(chain!=='solana'||!mint||!pool||!validDate(observedAt)||!validDate(decisionAt))throw new Error('INVALID_DECISION_IDENTITY');
  if(Date.parse(observedAt)>Date.parse(decisionAt))throw new Error('FUTURE_INFORMATION');
  if(!rawEvidenceHash||!modelVersion)throw new Error('MISSING_PROVENANCE');
  const identity={chain,mint,pool,observedAt,decisionAt,rawEvidenceHash,modelVersion};
  return Object.freeze({decisionId:hash(identity),...identity});
}
/** A network receipt is insufficient to declare a precise historical price. */
export function assessSample({decision,horizon,sample}){
  const target=Date.parse(decision.decisionAt)+horizon.seconds*1000,deadline=target+horizon.toleranceMs;
  if(sample.chain!==decision.chain||sample.mint!==decision.mint||sample.pool!==decision.pool)return {status:'WRONG_INSTRUMENT',target,deadline};
  if(!validDate(sample.retrievedAt)||!validDate(sample.providerAsOf))return {status:'UNVERIFIED_TIME',target,deadline};
  const retrieved=Date.parse(sample.retrievedAt),asOf=Date.parse(sample.providerAsOf);
  if(asOf>retrieved)return {status:'FUTURE_PROVIDER_TIME',target,deadline};
  if(retrieved<Date.parse(decision.decisionAt))return {status:'FUTURE_INFORMATION',target,deadline};
  if(!finitePositive(sample.priceUsd))return {status:'NO_VALID_PRICE',target,deadline};
  if(asOf<target)return {status:'BEFORE_HORIZON',target,deadline};
  if(asOf>deadline)return {status:'LATE',target,deadline};
  if(retrieved>deadline)return {status:'RETRIEVED_TOO_LATE',target,deadline};
  if(typeof sample.source!=='string'||!sample.source||!sample.rawEvidenceHash)return {status:'MISSING_PROVENANCE',target,deadline};
  return {status:'CAPTURED',target,deadline,targetAt:new Date(target).toISOString(),providerAsOf:sample.providerAsOf,retrievedAt:sample.retrievedAt,delaySeconds:Math.round((asOf-target)/1000),priceUsd:sample.priceUsd,source:sample.source,rawEvidenceHash:sample.rawEvidenceHash};
}
function sortSamples(samples){
  return [...samples].sort((a,b)=>(Date.parse(a.providerAsOf)||Infinity)-(Date.parse(b.providerAsOf)||Infinity)||(Date.parse(a.retrievedAt)||Infinity)-(Date.parse(b.retrievedAt)||Infinity)||String(a.rawEvidenceHash??'').localeCompare(String(b.rawEvidenceHash??'')));
}
export function resolveOutcome({decision,horizon,samples,now}){
  if(!validDate(now))throw new Error('INVALID_EVALUATION_TIME');
  const target=Date.parse(decision.decisionAt)+horizon.seconds*1000,deadline=target+horizon.toleranceMs,nowMs=Date.parse(now);
  const eligible=sortSamples(samples).filter(s=>validDate(s.retrievedAt)&&Date.parse(s.retrievedAt)<=nowMs).map(s=>assessSample({decision,horizon,sample:s})).find(x=>x.status==='CAPTURED');
  const base={decisionId:decision.decisionId,horizonSeconds:horizon.seconds,targetAt:new Date(target).toISOString(),deadlineAt:new Date(deadline).toISOString()};
  if(eligible)return {...base,status:'CAPTURED',sample:eligible};
  if(nowMs>deadline)return {...base,status:'MISSED_WINDOW',reason:'NO_TIME_VALID_VERIFIABLE_SAMPLE'};
  return {...base,status:'PENDING'};
}
export function appendEvidence(ledger,event){
  if(!Array.isArray(ledger))throw new TypeError('ledger must be array');
  if(!event||!event.id||!event.kind||!validDate(event.eventAt)||!event.rawEvidenceHash)throw new Error('INVALID_EVIDENCE_EVENT');
  const prev=ledger.find(x=>x.id===event.id);
  if(prev){if(hash(prev)!==hash(event))throw new Error('EVIDENCE_ID_CONFLICT');return ledger;}
  return [...ledger,Object.freeze({...event})];
}
export function intervalDiagnostics(runs,expectedPeriodMs=300000){
  const stamps=[...runs].filter(validDate).map(Date.parse).sort((a,b)=>a-b);
  const gaps=stamps.slice(1).map((v,i)=>v-stamps[i]);
  const late=gaps.filter(g=>g>expectedPeriodMs*1.5);
  return {scheduledIntervalSeconds:expectedPeriodMs/1000,observedRuns:stamps.length,gapsSeconds:gaps.map(x=>Math.round(x/1000)),lateGapCount:late.length,maxGapSeconds:gaps.length?Math.max(...gaps)/1000:null,medianGapSeconds:gaps.length?gaps.slice().sort((a,b)=>a-b)[Math.floor((gaps.length-1)/2)]/1000:null,collectorCadenceIsVerified:late.length===0&&gaps.length>=2};
}
