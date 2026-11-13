import { Router, type IRouter } from "express";
import { GetMeechainNetworkResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const RPC_URL = "https://node1.mintme.com";
const NETWORK_NAME = "MintMe" as const;
const EXPECTED_CHAIN_ID = 24734;
const RECENT_BLOCK_LIMIT = 10;
const RPC_TIMEOUT_MS = 9_000;

type RpcEnvelope = {
  result?: unknown;
  error?: { message?: string };
};

type RpcBlock = {
  number?: unknown;
  timestamp?: unknown;
  transactions?: unknown;
  gasUsed?: unknown;
};

type BlockMetric = {
  blockNumber: string;
  timestamp: string;
  transactionCount: number;
  gasUsed: string;
  intervalSeconds: number | null;
};

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`RPC returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as RpcEnvelope;
  if (payload.error) {
    throw new Error(payload.error.message ?? "RPC request failed");
  }
  if (!("result" in payload)) {
    throw new Error("RPC response did not include a result");
  }

  return payload.result;
}

function parseHexNumber(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`RPC returned an invalid ${field}`);
  }
  return BigInt(value);
}

function toSafeNumber(value: bigint, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`RPC returned an out-of-range ${field}`);
  }
  return number;
}

async function getBlock(blockNumber: bigint): Promise<BlockMetric> {
  const block = (await rpcCall("eth_getBlockByNumber", [
    `0x${blockNumber.toString(16)}`,
    false,
  ])) as RpcBlock | null;

  if (!block || !Array.isArray(block.transactions)) {
    throw new Error("RPC did not return the requested block");
  }

  const parsedNumber = parseHexNumber(block.number, "block number");
  const timestamp = parseHexNumber(block.timestamp, "block timestamp");
  const gasUsed = parseHexNumber(block.gasUsed, "gas used");
  const timestampNumber = toSafeNumber(timestamp, "block timestamp");

  return {
    blockNumber: parsedNumber.toString(),
    timestamp: new Date(timestampNumber * 1_000).toISOString(),
    transactionCount: block.transactions.length,
    gasUsed: gasUsed.toString(),
    intervalSeconds: null,
  };
}

router.get("/meechain/network", async (req, res): Promise<void> => {
  let observedChainId: number | null = null;

  try {
    const chainId = parseHexNumber(await rpcCall("eth_chainId", []), "chain ID");
    observedChainId = toSafeNumber(chainId, "chain ID");

    if (observedChainId !== EXPECTED_CHAIN_ID) {
      res.json(
        GetMeechainNetworkResponse.parse({
          name: NETWORK_NAME,
          rpcUrl: RPC_URL,
          expectedChainId: EXPECTED_CHAIN_ID,
          observedChainId,
          status: "wrong_network",
          latestBlock: null,
          recentBlocks: [],
          checkedAt: new Date().toISOString(),
          message: "The RPC responded, but its chain ID does not match MintMe.",
        }),
      );
      return;
    }

    const latestHeight = parseHexNumber(
      await rpcCall("eth_blockNumber", []),
      "block height",
    );
    const firstHeight =
      latestHeight >= BigInt(RECENT_BLOCK_LIMIT - 1)
        ? latestHeight - BigInt(RECENT_BLOCK_LIMIT - 1)
        : 0n;
    const heights = Array.from(
      { length: Number(latestHeight - firstHeight + 1n) },
      (_, index) => firstHeight + BigInt(index),
    );
    const recentBlocks = await Promise.all(heights.map(getBlock));

    for (let index = 1; index < recentBlocks.length; index += 1) {
      const priorTime = new Date(recentBlocks[index - 1].timestamp).getTime();
      const currentTime = new Date(recentBlocks[index].timestamp).getTime();
      recentBlocks[index].intervalSeconds = Math.max(
        0,
        (currentTime - priorTime) / 1_000,
      );
    }

    res.json(
      GetMeechainNetworkResponse.parse({
        name: NETWORK_NAME,
        rpcUrl: RPC_URL,
        expectedChainId: EXPECTED_CHAIN_ID,
        observedChainId,
        status: "connected",
        latestBlock: recentBlocks.at(-1) ?? null,
        recentBlocks,
        checkedAt: new Date().toISOString(),
        message: null,
      }),
    );
  } catch (error) {
    req.log.warn(
      { err: error, observedChainId },
      "Could not read MintMe network status",
    );
    res.json(
      GetMeechainNetworkResponse.parse({
        name: NETWORK_NAME,
        rpcUrl: RPC_URL,
        expectedChainId: EXPECTED_CHAIN_ID,
        observedChainId,
        status: "unavailable",
        latestBlock: null,
        recentBlocks: [],
        checkedAt: new Date().toISOString(),
        message: "Could not reach or read the configured MintMe RPC endpoint.",
      }),
    );
  }
});

export default router;
