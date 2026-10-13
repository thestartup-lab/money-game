import { useState } from 'react';
import type { Player } from '../../types/game';

export default function PlanningChoices({options,onConfirm}:{options:NonNullable<Player['planningOptions']>;onConfirm:(id:string)=>void}) {
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const selected=options.find(o=>o.id===selectedId);
  if (selected) return <section className="rounded-xl border border-amber-400 bg-slate-900 p-4 text-lg text-white">
    <h3 className="font-bold">{selected.label}</h3><p className="my-3 leading-relaxed">{selected.description}</p>
    <p className="mb-3 text-base">確認即執行。本次規劃每項成長服務限一次、基本投資限選一種一份，第二人生挑戰限選一種投入方式。</p>
    <button className="mb-2 min-h-12 w-full rounded-lg bg-emerald-700 p-3 disabled:opacity-40" disabled={selected.disabled}
      onClick={()=>{onConfirm(selected.id);setSelectedId(null);}}>確認執行</button>
    <button className="min-h-12 w-full rounded-lg border p-3" onClick={()=>setSelectedId(null)}>取消，返回選項</button>
  </section>;
  return <section className="space-y-3 text-lg text-white" aria-label="人生規劃成長與生活選項">
    {[...new Set(options.map(o=>o.group??'其他'))].map(group=><details key={group} className="rounded-xl border border-slate-600 bg-slate-900 p-4">
      <summary className="cursor-pointer font-bold">{group}</summary>
      <div className="mt-3 space-y-2">{options.filter(o=>(o.group??'其他')===group).map(o=><button key={o.id}
        className="min-h-12 w-full rounded-lg border border-slate-500 p-3 text-left disabled:opacity-40" disabled={o.disabled}
        onClick={()=>setSelectedId(o.id)}>{o.label}</button>)}</div>
    </details>)}
  </section>;
}
