import { vi } from 'vitest'

export const mockPublicKey = vi.fn().mockImplementation((key) => ({
  toString:  () => key,
  toBase58:  () => String(key),
  toBuffer:  () => Buffer.alloc(32),
}))

export const mockConnection = {
  getBalance:           vi.fn(async () => 1_000_000_000),
  getRecentBlockhash:   vi.fn(async () => ({ blockhash: 'mockhash', feeCalculator: { lamportsPerSignature: 5000 } })),
  sendRawTransaction:   vi.fn(async () => 'mockTxSignature'),
  confirmTransaction:   vi.fn(async () => ({ value: { err: null } })),
}

export const mockKeypair = {
  publicKey:  { toString: () => 'mockWalletPublicKey', toBase58: () => 'mockWalletPublicKey' },
  secretKey:  new Uint8Array(64),
}

export const solanaMockModule = {
  Connection:                  vi.fn(() => mockConnection),
  PublicKey:                   mockPublicKey,
  Keypair:                     { fromSecretKey: vi.fn(() => mockKeypair) },
  Transaction:                 vi.fn(() => ({ add: vi.fn().mockReturnThis(), sign: vi.fn() })),
  sendAndConfirmTransaction:   vi.fn(async () => 'mockTxSignature'),
  LAMPORTS_PER_SOL:            1_000_000_000,
  SystemProgram:               { transfer: vi.fn() },
}
