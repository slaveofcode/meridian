/**
 * Multi-key RPC rotation utility.
 * Supports comma-separated HELIUS_API_KEY values.
 * Rotates through keys on 429 rate limits automatically.
 */

let rpcKeyIndex = 0;

/**
 * Get list of all Helius RPC URLs from comma-separated API keys.
 * Includes public Solana RPC as final fallback.
 */
function getRpcUrls() {
  const keys = (process.env.HELIUS_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  if (!keys.length) return ['https://api.mainnet-beta.solana.com'];
  const urls = keys.map(key => `https://mainnet.helius-rpc.com/?api-key=${key}`);
  urls.push('https://api.mainnet-beta.solana.com');
  return urls;
}

/**
 * Get list of all Helius wallet API base URLs (api.helius.xyz).
 */
function getHeliusWalletUrls() {
  const keys = (process.env.HELIUS_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  return keys.map(key => ({ key, url: `https://api.helius.xyz` }));
}

/**
 * Get the next RPC URL in rotation (round-robin).
 */
export function nextRpcUrl() {
  const urls = getRpcUrls();
  const url = urls[rpcKeyIndex % urls.length];
  rpcKeyIndex++;
  return url;
}

/**
 * Get next Helius wallet API URL + key combination.
 */
export function nextHeliusWalletUrl() {
  const endpoints = getHeliusWalletUrls();
  if (!endpoints.length) return null;
  const ep = endpoints[rpcKeyIndex % endpoints.length];
  rpcKeyIndex++;
  return ep;
}

/**
 * Reset rotation index (optional, for fresh starts).
 */
export function resetRotation() {
  rpcKeyIndex = 0;
}
