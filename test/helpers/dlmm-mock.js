import { vi } from 'vitest'

export const mockDlmmPosition = {
  publicKey: { toString: () => 'mockPositionAddress' },
  positionData: {
    lowerBinId:  -10,
    upperBinId:   10,
    feeX:        { toString: () => '1000000' },
    feeY:        { toString: () => '1000000' },
    liquidityShares: [],
  },
}

export const mockDlmmInstance = {
  getPositionsByUserAndLbPair: vi.fn(async () => ({ userPositions: [mockDlmmPosition] })),
  addLiquidityByStrategy:      vi.fn(async () => ({ txs: ['mockDeployTx'] })),
  removeLiquidity:             vi.fn(async () => ({ txs: ['mockCloseTx'] })),
  claimSwapFee:                vi.fn(async () => ({ txs: ['mockClaimTx'] })),
  getActiveBin:                vi.fn(async () => ({ binId: 0, price: '1.0', pricePerToken: '1.0' })),
  lbPair: {
    parameters: { baseFactor: 100, filterPeriod: 30, decayPeriod: 600, reductionFactor: 5000, variableFeeControl: 40000 },
  },
}

export const dlmmMockModule = {
  default: {
    create: vi.fn(async () => mockDlmmInstance),
  },
  DLMM: {
    create: vi.fn(async () => mockDlmmInstance),
  },
  StrategyType: {
    SpotImBalanced: 'SpotImBalanced',
    BidAsk:         'BidAsk',
    Curve:          'Curve',
  },
}
