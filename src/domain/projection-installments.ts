import { cardCompetence, type CycleVersion } from "./card-competence.ts";
import { shiftMonth } from "./card-cycle.ts";

// F0c do Copiloto (parte 1): deriva, a partir de parcelas JÁ observadas no
// histórico, as parcelas FUTURAS que ainda não foram lançadas — a entrada que o
// motor usa para estimar faturas (ReconcileInput.bills) sem esperar o banco
// lançar cada mês. Função PURA: sem I/O, sem banco, não muta a entrada e é
// determinística (séries e byBill ordenados por key). A competência de cada
// parcela vem de cardCompetence (regra única do ciclo), nunca reimplementada.

export type InstallmentLine = {
  id: string;
  card: string;
  purchaseDate: string | null;
  transactionDate: string;
  // merchant já normalizado pelo chamador, sem o marcador de parcela (k/n).
  merchant: string;
  // valor POSITIVO de uma parcela, em centavos.
  cents: bigint;
  k: number;
  n: number;
  billDueDate: string | null;
};

/**
 * Tira da descrição o marcador de parcela que o banco cola no nome
 * ("LOJA01/10", "LOJA 01/10", "LOJA PARC 1/10", "LOJA 1 DE 10"), para que todas
 * as parcelas da mesma compra caiam na mesma série. Só remove o marcador que
 * bate com k e n; o resto da descrição fica como veio.
 */
export function stripInstallmentMarker(description: string, k: number, n: number): string {
  const marker = new RegExp(
    `\\s*[-(]?\\s*(?:parc(?:ela)?\\.?\\s*)?0*${k}\\s*(?:/|de)\\s*0*${n}\\s*\\)?\\s*$`,
    "i",
  );
  const stripped = description.replace(marker, "").trim();
  return stripped || description.trim();
}

export type DerivedInstallment = { k: number; dueMonth: string; cents: bigint };

export type InstallmentSeries = {
  key: string;
  card: string;
  // os k efetivamente observados no histórico, ordenados.
  observed: number[];
  derived: DerivedInstallment[];
  quality: "structural" | "estimated";
};

export type DeriveInstallmentsResult = {
  series: InstallmentSeries[];
  // card|YYYY-MM -> soma das parcelas DERIVADAS cujo vencimento é >= fromMonth.
  byBill: Map<string, bigint>;
};

// Identidade de uma série de parcelamento. A semelhança nunca funde: duas
// linhas só casam na mesma série se TODOS os componentes forem iguais. Sem data
// da compra, cada linha é uma série própria (ancorada no id), por isso o valor
// base e o id entram na chave — não há como provar que duas parcelas sem data
// pertencem à mesma compra.
type SeriesIdentity = {
  card: string;
  // purchaseDate quando existe; senão o id da linha (série isolada).
  anchor: string;
  n: number;
  merchant: string;
  valorBase: bigint;
  hasPurchaseDate: boolean;
};

// Agrupa linhas por identidade e, dentro de cada identidade, por k. Linhas
// idênticas com o mesmo k viram séries SEPARADAS: a multiplicidade é o máximo
// de linhas observadas com um mesmo k (ex. duas 3/10 idênticas = 2 séries).
type Bucket = {
  identity: SeriesIdentity;
  linesByK: Map<number, InstallmentLine[]>;
};

function identityKey(id: SeriesIdentity): string {
  return [id.card, id.anchor, id.n, id.merchant, id.valorBase.toString()].join(
    "\u0000",
  );
}

// valorBase de uma identidade = cents de uma parcela observada com k<n. Quando
// só existe a última (k=n), não há base própria; a última casa numa série
// existente se |cents - valorBase| <= n-1 (arredondamento das parcelas), por
// isso a base é escolhida entre as parcelas com k<n.
function makeSeriesKey(id: SeriesIdentity, copyIndex: number): string {
  return `inst:${id.card}:${id.anchor}:${id.n}:${id.merchant}:${id.valorBase.toString()}#${copyIndex}`;
}

export function deriveInstallments(
  lines: InstallmentLine[],
  cyclesByCard: Map<string, CycleVersion[]>,
  fromMonth: string,
): DeriveInstallmentsResult {
  // Primeiro passo: resolver a identidade de cada linha. Com data da compra, o
  // valor base é o de uma parcela com k<n daquela compra; a última parcela
  // (k=n) ancora na base compatível (|cents-base| <= n-1). Sem data da compra,
  // a linha é sua própria série e o valor base é o próprio cents.
  const withPurchase = lines.filter((l) => l.purchaseDate !== null);
  const withoutPurchase = lines.filter((l) => l.purchaseDate === null);

  // Agrupa as linhas COM data da compra por (card, purchaseDate, n, merchant)
  // para descobrir o valor base antes de fixar a identidade — a base vem das
  // parcelas com k<n, e a última se anexa à base compatível.
  const groups = new Map<string, InstallmentLine[]>();
  for (const line of withPurchase) {
    const gk = [line.card, line.purchaseDate, line.n, line.merchant].join(
      "\u0000",
    );
    const bucket = groups.get(gk);
    if (bucket) bucket.push(line);
    else groups.set(gk, [line]);
  }

  const buckets = new Map<string, Bucket>();
  const addLine = (identity: SeriesIdentity, line: InstallmentLine) => {
    const ik = identityKey(identity);
    let bucket = buckets.get(ik);
    if (!bucket) {
      bucket = { identity, linesByK: new Map() };
      buckets.set(ik, bucket);
    }
    const atK = bucket.linesByK.get(line.k);
    if (atK) atK.push(line);
    else bucket.linesByK.set(line.k, [line]);
  };

  for (const group of groups.values()) {
    // Bases das parcelas com k<n. O banco arredonda: a 1ª parcela costuma levar
    // os centavos que sobram (266,67 e depois 266,66), então valores a até n-1
    // centavos de uma base já vista são a mesma compra, não outra série.
    const bases: bigint[] = [];
    for (const l of [...group].filter((x) => x.k < x.n).sort((a, b) => a.k - b.k))
      if (!bases.some((b) => absBig(l.cents - b) <= BigInt(l.n - 1))) bases.push(l.cents);
    const first = group[0]!;
    for (const line of group) {
      let valorBase: bigint;
      if (line.k < line.n)
        valorBase = bases.find((b) => absBig(line.cents - b) <= BigInt(line.n - 1)) ?? line.cents;
      else {
        // Última parcela: casa na base cujo |cents - base| <= n-1; se nenhuma,
        // fica como sua própria base (não funde).
        const match = bases.find(
          (b) => absBig(line.cents - b) <= BigInt(line.n - 1),
        );
        valorBase = match ?? line.cents;
      }
      addLine(
        {
          card: line.card,
          anchor: first.purchaseDate!,
          n: line.n,
          merchant: line.merchant,
          valorBase,
          hasPurchaseDate: true,
        },
        line,
      );
    }
  }

  // Linhas SEM data da compra: cada uma é sua própria série (não anexa por
  // semelhança), ancorada no id, com valor base = próprio cents.
  for (const line of withoutPurchase) {
    addLine(
      {
        card: line.card,
        anchor: line.id,
        n: line.n,
        merchant: line.merchant,
        valorBase: line.cents,
        hasPurchaseDate: false,
      },
      line,
    );
  }

  // Segundo passo: expandir cada bucket em séries pela multiplicidade (máximo
  // de linhas com um mesmo k) e derivar as parcelas futuras.
  const series: InstallmentSeries[] = [];
  const byBill = new Map<string, bigint>();

  for (const bucket of buckets.values()) {
    const { identity, linesByK } = bucket;
    const multiplicity = Math.max(
      ...[...linesByK.values()].map((v) => v.length),
    );
    const observed = [...linesByK.keys()].sort((a, b) => a - b);
    const maxObserved = observed[observed.length - 1]!;
    const cycles = cyclesByCard.get(identity.card) ?? [];

    // Competência da parcela observada de maior k, âncora da derivação. Sem
    // data da compra ou sem ciclo conhecido, a competência é desconhecida:
    // nada é derivado e a qualidade é estimada.
    let anchorMonth: string | null = null;
    if (identity.hasPurchaseDate && cycles.length > 0) {
      const c = cardCompetence({
        transactionDate: identity.anchor,
        purchaseDate: identity.anchor,
        installment: { number: maxObserved, total: identity.n },
        cycles,
      });
      anchorMonth = c.month;
    }

    const derived: DerivedInstallment[] = [];
    if (anchorMonth !== null) {
      // Deriva k' = maxObserved+1 .. n, só para os k' NÃO observados. Valor
      // derivado = valorBase. dueMonth(k') = shiftMonth(anchorMonth, k'-maxObserved).
      for (let kPrime = maxObserved + 1; kPrime <= identity.n; kPrime++) {
        if (linesByK.has(kPrime)) continue;
        const dueMonth = shiftMonth(anchorMonth, kPrime - maxObserved);
        derived.push({ k: kPrime, dueMonth, cents: identity.valorBase });
      }
    }

    const quality: "structural" | "estimated" =
      identity.hasPurchaseDate && anchorMonth !== null
        ? "structural"
        : "estimated";

    for (let copy = 0; copy < multiplicity; copy++) {
      // Cada cópia recebe uma key única pelo índice 1-based (#1, #2, ...),
      // estável e determinística: o motor (project) rejeita keys duplicadas.
      series.push({
        key: makeSeriesKey(identity, copy + 1),
        card: identity.card,
        observed: [...observed],
        derived: derived.map((d) => ({ ...d })),
        quality,
      });
      // byBill soma as parcelas derivadas com dueMonth >= fromMonth. Cada cópia
      // (multiplicidade) soma de novo, por isso vive dentro do laço de cópias.
      for (const d of derived) {
        if (d.dueMonth < fromMonth) continue;
        const billKey = `${identity.card}|${d.dueMonth}`;
        byBill.set(billKey, (byBill.get(billKey) ?? 0n) + d.cents);
      }
    }
  }

  series.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { series, byBill };
}

function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}
