"use client";
// Projeção da fatura do cartão mês a mês (A+B). Barras empilhadas por origem:
// recorrentes, gasto do dia a dia (estimativa), parcelas e gastos pontuais.
// O mês selecionado é o mesmo da jornada; compras simuladas entram no rascunho.
import { Select } from "../ds/select.tsx";
import { useState } from "react";
import { cardBill, fmt, installmentEnd, monthLong, monthName, monthShort, type BillPart, type Plan } from "./engine.ts";
import { ChangedText, Icon, Money, MoneyStepper, useCopilot, useElementWidth, useTween } from "./kit.tsx";

const SIM_ID = "sim-compra";

/** Camadas fixas, de baixo para cima; parcelas ganham uma camada cada. */
function layersFor(plan: Plan) {
  const out: { key: string; label: string; tone: string; match: (p: BillPart) => boolean }[] = [
    { key: "rec", label: "Recorrentes", tone: "rec", match: (p) => p.kind === "recorrente" },
    { key: "var", label: "Dia a dia (média)", tone: "var", match: (p) => p.kind === "variavel" },
  ];
  plan.card.installments.forEach((inst, k) =>
    out.push({ key: "parc-" + inst.id, label: inst.label, tone: inst.simulated ? "sim" : "parc-" + (k % 4), match: (p) => p.id === "parc-" + inst.id }),
  );
  out.push({ key: "ext", label: "Gastos pontuais", tone: "ext", match: (p) => p.kind === "extra" });
  return out;
}

export function CardProjection() {
  const s = useCopilot();
  const n = s.horizon;
  const plan = s.draft;
  const layers = layersFor(plan);
  const bills = Array.from({ length: n }, (_, i) => cardBill(plan.card, i));
  const savedBills = Array.from({ length: n }, (_, i) => cardBill(s.saved.card, i));
  const values = bills.map((b) => layers.map((l) => b.parts.filter(l.match).reduce((a, p) => a + p.amount, 0)));

  const [ref, w] = useElementWidth<HTMLDivElement>(800);
  const W = Math.max(w, n * 46);
  const H = 240;
  const top = 26;
  const base = H - 6;
  const col = W / n;
  const barW = Math.min(44, col * 0.62);
  const max = Math.max(1, ...bills.map((b) => b.total), ...savedBills.map((b) => b.total));
  const k = (base - top) / max;
  const tw = useTween(values.flat(), 420);
  const at = (i: number, j: number) => tw[i * layers.length + j] ?? 0;

  const sel = Math.min(s.sel, n - 1);
  const bill = bills[sel];
  const prev = sel > 0 ? bills[sel - 1].total : null;
  const row = s.pD.rows[sel];
  const ends = plan.card.installments.map((p) => ({ p, end: installmentEnd(p) })).filter(({ end }) => end + 1 < n && end >= 0);
  const first = bills[0].total;
  const low = Math.min(...bills.map((b) => b.total));
  const lowAt = bills.findIndex((b) => b.total === low);

  return (
    <section className="cf-card" aria-labelledby="card-title">
      <header className="cf-card-head">
        <h2 id="card-title" className="cf-a-h2">
          Fatura do cartão
        </h2>
        <p className="cf-a-lede">
          {fmt(first)} em {monthShort(0)}
          {low < first ? (
            <>
              , caindo para <strong>{fmt(low)}</strong> em {monthShort(lowAt)} conforme as parcelas terminam
            </>
          ) : null}
          . Barras claras são estimativa (média do gasto do dia a dia).
        </p>
      </header>

      <div className="cf-card-body">
        <div className="cf-card-chart-col">
          <div ref={ref} className="cf-card-chart" role="group" aria-label={`Fatura projetada por mês, ${n} meses`}>
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
              <defs>
                <pattern id="cf-card-est" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="5" className="cf-card-est-line" />
                </pattern>
              </defs>
              <rect className="cf-card-sel" x={0} y={0} width={col} height={H} style={{ transform: `translateX(${sel * col}px)` }} />
              {bills.map((_, i) => {
                const cx = (i + 0.5) * col;
                let acc = 0;
                const total = layers.reduce((a, __, j) => a + at(i, j), 0);
                return (
                  <g key={i} className="cf-card-bar" data-sel={i === sel || undefined}>
                    {layers.map((l, j) => {
                      const v = at(i, j);
                      const y = base - (acc + v) * k;
                      acc += v;
                      return v > 0.5 ? <rect key={l.key} x={cx - barW / 2} y={y} width={barW} height={Math.max(0, v * k - 1)} className="cf-card-seg" data-tone={l.tone} rx={2} /> : null;
                    })}
                    {s.dirty && Math.round(savedBills[i].total) !== Math.round(bills[i].total) ? (
                      <rect x={cx - barW / 2 - 3} y={base - savedBills[i].total * k} width={barW + 6} height={savedBills[i].total * k} className="cf-card-ghost" rx={3} />
                    ) : null}
                    {i === sel || n <= 12 ? (
                      <text x={cx} y={base - total * k - 7} className="cf-card-total" textAnchor="middle">
                        {fmt(total).replace("R$ ", "")}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <line x1={0} x2={W} y1={base} y2={base} className="cf-card-base" />
            </svg>
            <div className="cf-card-x" style={{ width: W }}>
              {bills.map((b, i) => {
                const ended = ends.filter(({ end }) => end + 1 === i);
                return (
                  <button key={i} type="button" style={{ width: col }} aria-pressed={i === sel} aria-label={`${monthLong(i)}: fatura de ${fmt(b.total)}`} onClick={() => s.setSel(i)}>
                    <span>{n > 12 && i % 2 === 1 && i !== sel ? "" : monthName(i)}</span>
                    {ended.length ? <small>−{fmt(ended.reduce((a, e) => a + e.p.amount, 0)).replace("R$ ", "R$ ")}</small> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="cf-card-legend" aria-label="Legenda">
            {layers
              .filter((l, j) => values.some((v) => v[j] > 0))
              .map((l) => (
                <li key={l.key} data-tone={l.tone}>
                  <span aria-hidden />
                  {l.label}
                </li>
              ))}
            {s.dirty ? (
              <li data-tone="ghost">
                <span aria-hidden />
                Fatura no plano atual
              </li>
            ) : null}
          </ul>
        </div>

        <aside className="cf-card-month" aria-live="polite">
          <h3>
            Fatura de <ChangedText value={monthShort(sel)} />
          </h3>
          <p className="cf-card-big">
            <Money v={bill.total} />
            {prev !== null && Math.round(prev) !== Math.round(bill.total) ? (
              <small>
                {bill.total < prev ? "−" : "+"}
                {fmt(Math.abs(bill.total - prev))} sobre {monthShort(sel - 1)}
              </small>
            ) : null}
          </p>
          <ul className="cf-card-parts">
            {bill.parts.map((p) => {
              const inst = p.kind === "parcela" ? plan.card.installments.find((x) => "parc-" + x.id === p.id) : null;
              return (
                <li key={p.id} data-kind={p.kind} data-sim={p.simulated || undefined}>
                  <span>
                    {p.label}
                    {p.kind === "parcela" ? (
                      <small>
                        parcela {p.n}/{p.total}
                        {inst ? ` · última em ${monthShort(installmentEnd(inst))}` : ""}
                        {p.simulated ? " · simulada" : ""}
                      </small>
                    ) : p.kind === "variavel" ? (
                      <small>estimativa pela média das últimas faturas</small>
                    ) : null}
                  </span>
                  <span>{fmt(p.amount)}</span>
                </li>
              );
            })}
          </ul>
          <p className="cf-card-share">
            Depois de essenciais e contas fixas sobram {fmt(row.preCard)}. A fatura leva {fmt(row.card)}, ficam <strong>{fmt(row.budget)}</strong> para dívidas, objetivos e folga.
          </p>
        </aside>
      </div>

      <CardSimulator />
    </section>
  );
}

function CardSimulator() {
  const s = useCopilot();
  const sim = s.draft.card.installments.find((p) => p.id === SIM_ID);
  const [value, setValue] = useState(1800);
  const [times, setTimes] = useState(6);
  const [from, setFrom] = useState(1);
  const apply = (v = value, t = times, f = from) =>
    s.setDraft((p) => ({
      ...p,
      card: {
        ...p.card,
        installments: [
          ...p.card.installments.filter((x) => x.id !== SIM_ID),
          { id: SIM_ID, label: "Compra simulada", amount: Math.ceil(v / t), total: t, paid: 0, start: f, simulated: true },
        ],
      },
    }));
  const remove = () => s.setDraft((p) => ({ ...p, card: { ...p.card, installments: p.card.installments.filter((x) => x.id !== SIM_ID) } }));
  const minFree = Math.min(...s.pD.rows.slice(0, s.horizon).map((r) => r.free));
  return (
    <div className="cf-card-sim">
      <div className="cf-card-sim-block">
        <h3>E se vocês parcelarem uma compra?</h3>
        <div className="cf-card-sim-row">
          <MoneyStepper
            compact
            label="Valor total"
            value={value}
            step={100}
            onChange={(v) => {
              setValue(v);
              if (sim) apply(v);
            }}
          />
          <div className="cf-field">
            <label htmlFor="card-times">Parcelas</label>
            <Select
              id="card-times"
              value={times}
              onChange={(e) => {
                setTimes(Number(e.target.value));
                if (sim) apply(value, Number(e.target.value));
              }}
            >
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((t) => (
                <option key={t} value={t}>
                  {t}× de {fmt(Math.ceil(value / t))}
                </option>
              ))}
            </Select>
          </div>
          <div className="cf-field">
            <label htmlFor="card-from">Primeira fatura</label>
            <Select
              id="card-from"
              value={from}
              onChange={(e) => {
                setFrom(Number(e.target.value));
                if (sim) apply(value, times, Number(e.target.value));
              }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>
                  {monthShort(i)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="cf-card-sim-actions">
          {sim ? (
            <>
              <p>
                <Icon name="info" size={16} /> Folga mínima no horizonte: <Money v={minFree} />
                {minFree < 0 ? ". Nos meses no vermelho, a diferença sai do saldo em conta." : "."}
              </p>
              <button type="button" className="cf-btn is-quiet" onClick={remove}>
                <Icon name="close" size={16} /> Tirar a compra
              </button>
            </>
          ) : (
            <button type="button" className="cf-btn is-line" onClick={() => apply()}>
              Simular na fatura
            </button>
          )}
        </div>
      </div>
      <div className="cf-card-sim-block">
        <MoneyStepper
          label="Gasto do dia a dia no cartão (média por mês)"
          value={s.draft.card.variableAvg}
          step={50}
          onChange={(v) => s.setDraft((p) => ({ ...p, card: { ...p.card, variableAvg: v } }))}
          hint={`No plano: ${fmt(s.saved.card.variableAvg)}. Cada R$ 50 a menos vira R$ 50 de folga por mês.`}
        />
      </div>
    </div>
  );
}
