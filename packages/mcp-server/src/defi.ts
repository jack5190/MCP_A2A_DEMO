/**
 * In-memory mock DeFi backend for the AutoA2A demo.
 *
 * This is intentionally deterministic-ish: each price read nudges the price by a
 * small pseudo-random walk seeded from a counter, so that price-threshold triggers
 * can realistically fire while remaining reproducible within a session.
 */

export interface Market {
  symbol: string;
  /** Human readable name. */
  name: string;
  /** Current price quoted in USDC. */
  price: number;
  /** Annual percentage yield offered when staking this asset (as a fraction). */
  stakingApy: number;
}

export interface StakePosition {
  symbol: string;
  amount: number;
  apy: number;
  since: string;
}

export interface Portfolio {
  balances: Record<string, number>;
  staked: StakePosition[];
  totalValueUsd: number;
}

const SEED_MARKETS: Market[] = [
  { symbol: "BTC", name: "Bitcoin", price: 68000, stakingApy: 0.02 },
  { symbol: "ETH", name: "Ethereum", price: 3500, stakingApy: 0.04 },
  { symbol: "BNB", name: "BNB", price: 600, stakingApy: 0.05 },
  { symbol: "SOL", name: "Solana", price: 150, stakingApy: 0.07 },
  { symbol: "USDC", name: "USD Coin", price: 1, stakingApy: 0.03 },
];

export class DefiState {
  private markets: Map<string, Market> = new Map();
  private balances: Map<string, number> = new Map();
  private stakes: StakePosition[] = [];
  private tick = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.markets = new Map(SEED_MARKETS.map((m) => [m.symbol, { ...m }]));
    this.balances = new Map([
      ["USDC", 10000],
      ["ETH", 1],
    ]);
    this.stakes = [];
    this.tick = 0;
  }

  private nudgePrice(market: Market): void {
    if (market.symbol === "USDC") return;
    this.tick += 1;
    // Deterministic pseudo-random walk in the range of roughly +/- 1.5%.
    const wobble = Math.sin(this.tick * 1.3 + market.price) * 0.015;
    market.price = Math.max(0.01, Number((market.price * (1 + wobble)).toFixed(2)));
  }

  listMarkets(): Market[] {
    return Array.from(this.markets.values()).map((m) => ({ ...m }));
  }

  getPrice(symbol: string): number {
    const market = this.markets.get(symbol.toUpperCase());
    if (!market) {
      throw new Error(`Unknown market: ${symbol}`);
    }
    this.nudgePrice(market);
    return market.price;
  }

  private priceOf(symbol: string): number {
    const market = this.markets.get(symbol.toUpperCase());
    if (!market) throw new Error(`Unknown market: ${symbol}`);
    return market.price;
  }

  getPortfolio(): Portfolio {
    const balances: Record<string, number> = {};
    let total = 0;
    for (const [symbol, amount] of this.balances.entries()) {
      balances[symbol] = Number(amount.toFixed(6));
      total += amount * this.priceOf(symbol);
    }
    for (const stake of this.stakes) {
      total += stake.amount * this.priceOf(stake.symbol);
    }
    return {
      balances,
      staked: this.stakes.map((s) => ({ ...s })),
      totalValueUsd: Number(total.toFixed(2)),
    };
  }

  swap(fromSymbol: string, toSymbol: string, amount: number) {
    const from = fromSymbol.toUpperCase();
    const to = toSymbol.toUpperCase();
    if (from === to) throw new Error("Cannot swap an asset for itself");
    if (amount <= 0) throw new Error("Swap amount must be positive");
    const held = this.balances.get(from) ?? 0;
    if (held < amount) {
      throw new Error(`Insufficient ${from} balance: have ${held}, need ${amount}`);
    }
    const fromPrice = this.priceOf(from);
    const toPrice = this.priceOf(to);
    const usdValue = amount * fromPrice;
    const received = usdValue / toPrice;
    this.balances.set(from, held - amount);
    this.balances.set(to, (this.balances.get(to) ?? 0) + received);
    return {
      from,
      to,
      amountIn: amount,
      amountOut: Number(received.toFixed(6)),
      priceIn: fromPrice,
      priceOut: toPrice,
      usdValue: Number(usdValue.toFixed(2)),
    };
  }

  stake(symbol: string, amount: number) {
    const sym = symbol.toUpperCase();
    if (amount <= 0) throw new Error("Stake amount must be positive");
    const held = this.balances.get(sym) ?? 0;
    if (held < amount) {
      throw new Error(`Insufficient ${sym} balance: have ${held}, need ${amount}`);
    }
    const market = this.markets.get(sym);
    if (!market) throw new Error(`Unknown market: ${sym}`);
    this.balances.set(sym, held - amount);
    const position: StakePosition = {
      symbol: sym,
      amount: Number(amount.toFixed(6)),
      apy: market.stakingApy,
      since: new Date().toISOString(),
    };
    this.stakes.push(position);
    return position;
  }
}

/**
 * Module-level singleton so that DeFi state persists across MCP tool calls and
 * across multiple executor runs within a single running process.
 */
export const defiState = new DefiState();
