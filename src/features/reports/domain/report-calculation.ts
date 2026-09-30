import { proportionAgorot, ratioBasisPoints } from "@/shared/lib/money-math";
import { addDays, daysBetween } from "@/shared/lib/store-time";

export type SalesChannel = "storefront" | "manual";

export interface SaleFact {
  channel: SalesChannel;
  documentId: string;
  date: string;
  productKey: string;
  name: string;
  quantityMilli: number;
  grossAgorot: number;
  discountAgorot: number;
  // null when the sale left no cost record (untracked stock or pre-inventory orders).
  cogsAgorot: number | null;
}

export interface ReportPeriod {
  from: string;
  to: string;
}

export interface ReportTotalsInput {
  cashCollectedAgorot: number;
  creditSalesAgorot: number;
  outstandingBalancesAgorot: number;
  purchasesAgorot: number;
  inventoryValueAgorot: number;
  shrinkageAgorot: number;
}

export interface ReportMetrics extends ReportTotalsInput {
  grossSalesAgorot: number;
  discountsAgorot: number;
  returnsAgorot: number;
  netSalesAgorot: number;
  cogsAgorot: number;
  costedSalesAgorot: number;
  uncostedSalesAgorot: number;
  grossProfitAgorot: number;
  grossMarginBasisPoints: number | null;
  costComplete: boolean;
  orderCount: number;
  averageOrderValueAgorot: number | null;
  unitsSoldMilli: number;
  stockTurnoverBasisPoints: number | null;
}

export interface ProductPerformance {
  productKey: string;
  name: string;
  quantityMilli: number;
  netSalesAgorot: number;
  profitAgorot: number | null;
  marginBasisPoints: number | null;
}

export interface ProfitPoint {
  label: string;
  from: string;
  to: string;
  netSalesAgorot: number;
  grossProfitAgorot: number;
}

export interface ChannelSummary {
  channel: SalesChannel;
  orderCount: number;
  netSalesAgorot: number;
  grossProfitAgorot: number;
}

export interface ReportResult {
  period: ReportPeriod;
  metrics: ReportMetrics;
  byQuantity: ProductPerformance[];
  byRevenue: ProductPerformance[];
  byProfit: ProductPerformance[];
  byMargin: ProductPerformance[];
  profitSeries: ProfitPoint[];
  channels: ChannelSummary[];
}

const RANKING_SIZE = 5;
const net = (fact: SaleFact) => fact.grossAgorot - fact.discountAgorot;
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

interface Totals {
  net: number;
  costedNet: number;
  cogs: number;
}

function totals(
  sales: readonly SaleFact[],
  returns: readonly SaleFact[],
): Totals {
  const costed = (facts: readonly SaleFact[]) =>
    facts.filter((fact) => fact.cogsAgorot !== null);
  return {
    net: sum(sales.map(net)) - sum(returns.map(net)),
    costedNet: sum(costed(sales).map(net)) - sum(costed(returns).map(net)),
    cogs:
      sum(costed(sales).map((fact) => fact.cogsAgorot ?? 0)) -
      sum(costed(returns).map((fact) => fact.cogsAgorot ?? 0)),
  };
}

function seriesBuckets(period: ReportPeriod): Array<{
  label: string;
  from: string;
  to: string;
}> {
  const days = daysBetween(period.from, period.to) + 1;
  const step = days <= 31 ? 1 : days <= 120 ? 7 : 30;
  const buckets = [];
  for (
    let start = period.from;
    start <= period.to;
    start = addDays(start, step)
  ) {
    const end = addDays(start, step - 1);
    const to = end > period.to ? period.to : end;
    buckets.push({
      label: step === 1 ? start : `${start} – ${to}`,
      from: start,
      to,
    });
  }
  return buckets;
}

function rank(
  items: ProductPerformance[],
  score: (item: ProductPerformance) => number | null,
): ProductPerformance[] {
  return items
    .filter((item) => score(item) !== null)
    .sort(
      (a, b) =>
        (score(b) ?? 0) - (score(a) ?? 0) || a.name.localeCompare(b.name, "ar"),
    )
    .slice(0, RANKING_SIZE);
}

// Every figure is computed here from recorded facts; nothing is estimated.
// Profit uses the cost stored with each sale, and sales without a cost are reported separately.
export function buildReport(input: {
  period: ReportPeriod;
  sales: readonly SaleFact[];
  returns: readonly SaleFact[];
  totals: ReportTotalsInput;
}): ReportResult {
  const { sales, returns } = input;
  const all = totals(sales, returns);
  const grossSalesAgorot = sum(sales.map((fact) => fact.grossAgorot));
  const discountsAgorot = sum(sales.map((fact) => fact.discountAgorot));
  const returnsAgorot = sum(returns.map(net));
  const grossProfitAgorot = all.costedNet - all.cogs;
  const returnedDocuments = new Set(returns.map((fact) => fact.documentId));
  const orderCount = new Set(
    sales
      .map((fact) => fact.documentId)
      .filter((documentId) => !returnedDocuments.has(documentId)),
  ).size;

  const products = new Map<
    string,
    {
      name: string;
      quantity: number;
      net: number;
      costedNet: number;
      cogs: number;
      costed: boolean;
    }
  >();
  const apply = (fact: SaleFact, sign: 1 | -1) => {
    const entry = products.get(fact.productKey) ?? {
      name: fact.name,
      quantity: 0,
      net: 0,
      costedNet: 0,
      cogs: 0,
      costed: true,
    };
    entry.quantity += sign * fact.quantityMilli;
    entry.net += sign * net(fact);
    if (fact.cogsAgorot === null) entry.costed = false;
    else {
      entry.costedNet += sign * net(fact);
      entry.cogs += sign * fact.cogsAgorot;
    }
    products.set(fact.productKey, entry);
  };
  for (const fact of sales) apply(fact, 1);
  for (const fact of returns) apply(fact, -1);

  const performance = [...products.entries()]
    .filter(([, entry]) => entry.quantity > 0)
    .map(([productKey, entry]): ProductPerformance => {
      const profitAgorot = entry.costed ? entry.costedNet - entry.cogs : null;
      return {
        productKey,
        name: entry.name,
        quantityMilli: entry.quantity,
        netSalesAgorot: entry.net,
        profitAgorot,
        marginBasisPoints:
          profitAgorot === null
            ? null
            : ratioBasisPoints(profitAgorot, entry.costedNet),
      };
    });

  const within = (fact: SaleFact, from: string, to: string) =>
    fact.date >= from && fact.date <= to;
  const profitSeries = seriesBuckets(input.period).map((bucket) => {
    const part = totals(
      sales.filter((fact) => within(fact, bucket.from, bucket.to)),
      returns.filter((fact) => within(fact, bucket.from, bucket.to)),
    );
    return {
      ...bucket,
      netSalesAgorot: part.net,
      grossProfitAgorot: part.costedNet - part.cogs,
    };
  });

  const channels = (["storefront", "manual"] as const).map((channel) => {
    const channelSales = sales.filter((fact) => fact.channel === channel);
    const channelReturns = returns.filter((fact) => fact.channel === channel);
    const part = totals(channelSales, channelReturns);
    return {
      channel,
      orderCount: new Set(
        channelSales
          .map((fact) => fact.documentId)
          .filter((documentId) => !returnedDocuments.has(documentId)),
      ).size,
      netSalesAgorot: part.net,
      grossProfitAgorot: part.costedNet - part.cogs,
    };
  });

  return {
    period: input.period,
    metrics: {
      ...input.totals,
      grossSalesAgorot,
      discountsAgorot,
      returnsAgorot,
      netSalesAgorot: all.net,
      cogsAgorot: all.cogs,
      costedSalesAgorot: all.costedNet,
      uncostedSalesAgorot: all.net - all.costedNet,
      grossProfitAgorot,
      grossMarginBasisPoints: ratioBasisPoints(
        grossProfitAgorot,
        all.costedNet,
      ),
      costComplete: all.net === all.costedNet,
      orderCount,
      averageOrderValueAgorot:
        orderCount > 0 ? proportionAgorot(all.net, 1, orderCount) : null,
      unitsSoldMilli:
        sum(sales.map((fact) => fact.quantityMilli)) -
        sum(returns.map((fact) => fact.quantityMilli)),
      stockTurnoverBasisPoints: ratioBasisPoints(
        all.cogs,
        input.totals.inventoryValueAgorot,
      ),
    },
    byQuantity: rank(performance, (item) => item.quantityMilli),
    byRevenue: rank(performance, (item) => item.netSalesAgorot),
    byProfit: rank(performance, (item) => item.profitAgorot),
    byMargin: rank(performance, (item) => item.marginBasisPoints),
    profitSeries,
    channels,
  };
}

export const reportPresets = [
  "today",
  "week",
  "last14",
  "month",
  "custom",
] as const;
export type ReportPreset = (typeof reportPresets)[number];

export const reportPresetLabels: Record<ReportPreset, string> = {
  today: "اليوم",
  week: "هذا الأسبوع",
  last14: "آخر 14 يوماً",
  month: "هذا الشهر",
  custom: "فترة محددة",
};

const MAX_RANGE_DAYS = 366;

// The shop's week starts on Saturday.
export function resolvePeriod(
  preset: ReportPreset,
  today: string,
  custom?: { from?: string; to?: string },
): ReportPeriod {
  if (preset === "today") return { from: today, to: today };
  if (preset === "last14") return { from: addDays(today, -13), to: today };
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === "week") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { from: addDays(today, -((weekday + 1) % 7)), to: today };
  }
  const valid = (value?: string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const to = valid(custom?.to) ?? today;
  let from = valid(custom?.from) ?? to;
  if (from > to) from = to;
  if (daysBetween(from, to) >= MAX_RANGE_DAYS) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
  }
  return { from, to };
}
