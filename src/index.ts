import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { Request, Response } from "express";
import { z } from "zod";
import chalk from "chalk";
import { detectStack, bulkDetectStack, MAX_BULK_SIZE } from "./tools.js";
import { DEFAULT_USER_AGENT } from "./lib/fetchPage.js";

// ============================================================================
// Config (configSchema.source: code — MCPize derives the optional config form
// below). Everything is optional; the server runs correctly with zero config.
// ============================================================================

export const configSchema = z.object({
  userAgent: z
    .string()
    .optional()
    .describe(
      "Override the default User-Agent string sent when fetching pages. Leave empty to use " +
        `the default ("${DEFAULT_USER_AGENT}"), which honestly identifies this tool.`
    ),
});

// MCPize injects configured values as environment variables. USER_AGENT maps
// to the optional `userAgent` field above.
function getUserAgent(): string | undefined {
  const value = process.env.USER_AGENT?.trim();
  return value ? value : undefined;
}

// ============================================================================
// Dev Logging Utilities
// ============================================================================

const isDev = process.env.NODE_ENV !== "production";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function formatLatency(ms: number): string {
  if (ms < 100) return chalk.green(`${ms}ms`);
  if (ms < 500) return chalk.yellow(`${ms}ms`);
  return chalk.red(`${ms}ms`);
}

function truncate(str: string, maxLen = 60): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function logRequest(method: string, params?: unknown): void {
  if (!isDev) return;

  const paramsStr = params ? chalk.gray(` ${truncate(JSON.stringify(params))}`) : "";
  console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.cyan("→")} ${method}${paramsStr}`);
}

function logResponse(method: string, result: unknown, latencyMs: number): void {
  if (!isDev) return;

  const latency = formatLatency(latencyMs);

  // For tool calls, show the result
  if (method === "tools/call" && result) {
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    console.log(
      `${chalk.gray(`[${timestamp()}]`)} ${chalk.green("←")} ${truncate(resultStr)} ${chalk.gray(`(${latency})`)}`
    );
  } else {
    console.log(`${chalk.gray(`[${timestamp()}]`)} ${chalk.green("✓")} ${method} ${chalk.gray(`(${latency})`)}`);
  }
}

function logError(method: string, error: unknown, latencyMs: number): void {
  const latency = formatLatency(latencyMs);

  let errorMsg: string;
  if (error instanceof Error) {
    errorMsg = error.message;
  } else if (typeof error === "object" && error !== null) {
    // JSON-RPC error object has { code, message, data? }
    const rpcError = error as { message?: string; code?: number };
    errorMsg = rpcError.message || `Error ${rpcError.code || "unknown"}`;
  } else {
    errorMsg = String(error);
  }

  console.log(
    `${chalk.gray(`[${timestamp()}]`)} ${chalk.red("✖")} ${method} ${chalk.red(truncate(errorMsg))} ${chalk.gray(`(${latency})`)}`
  );
}

// ============================================================================
// MCP Server Setup
// ============================================================================

// Build a FRESH MCP server per request.
//
// In stateless streamable-HTTP mode the MCP SDK allows a Server to be connected
// to exactly ONE transport. Reusing a single module-scope instance throws
// "Already connected to a transport" on the second connection — and Cloud Run
// opens several (startup probe + real requests). So always create a new server
// (and a new transport) inside the request handler below.
const technologySchema = z.object({
  name: z.string().describe("The technology's name, e.g. \"WordPress\" or \"Cloudflare\"."),
  category: z.string().describe('Its primary category, e.g. "CMS", "CDN", "Analytics".'),
  confidence: z.number().int().min(0).max(100).describe("Deterministic fingerprint-match confidence, 0-100."),
  evidence: z.string().describe('What matched, e.g. "header: server, script src" — never a full raw HTML/header dump.'),
});

const detectResultSchema = z.object({
  input: z.string().describe("The URL exactly as it was submitted."),
  finalUrl: z.string().nullable().describe("The URL actually loaded after following redirects. Null if the page was never fetched."),
  httpStatus: z.number().int().nullable().describe("HTTP status code of the final response. Null if the page was never fetched."),
  status: z
    .enum(["OK", "NO_TECH_DETECTED", "UNREACHABLE", "BLOCKED", "INVALID_INPUT"])
    .describe(
      "OK/NO_TECH_DETECTED both mean the page fetched fine. INVALID_INPUT means the URL wasn't well-formed " +
        "http(s) — nothing was fetched. UNREACHABLE means DNS/timeout/connection failure. BLOCKED means the " +
        "site's own anti-bot/challenge wall stopped the check. Never treat BLOCKED as NO_TECH_DETECTED — one " +
        "means \"nothing recognizable here\", the other means \"we don't actually know.\""
    ),
  technologies: z.array(technologySchema).describe("Every technology detected, highest confidence first."),
  categoriesSummary: z
    .record(z.string(), z.number().int())
    .describe('Count of detected technologies per category, e.g. { "CMS": 1, "Analytics": 2 }.'),
});

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "tech-stack-detector",
    version: "1.0.0",
  });

  const userAgent = getUserAgent();

  server.registerTool(
    "detect_stack",
    {
      title: "Detect Website Technology Stack",
      description:
        "Fetch a single public web page and detect its technology stack — CMS, web/JS frameworks, ecommerce " +
        "platform, analytics/tag managers, web server, CDN, hosting, marketing pixels — by matching HTTP headers, " +
        "cookies, HTML markup and script tags against a large fingerprint dataset. No headless browser, no login " +
        "or paywall bypass. Distinguishes a site that blocked the check from one with nothing detected. " +
        'Example: { "url": "wordpress.org" }.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .describe('A website URL, e.g. "https://wordpress.org" or just "wordpress.org" (https:// is assumed).'),
      },
      outputSchema: detectResultSchema.shape,
    },
    async ({ url }) => {
      const output = await detectStack(url, { userAgent });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    }
  );

  server.registerTool(
    "bulk_detect_stack",
    {
      title: "Bulk Detect Website Technology Stacks",
      description:
        `Detect the technology stack for up to ${MAX_BULK_SIZE} URLs in one call, processed 5-at-a-time so one ` +
        "slow or blocked site never stalls the batch. Returns one result per URL plus a pass/fail summary — a " +
        'single bad URL never fails the batch. Example: { "urls": ["wordpress.org", "shopify.com"] }.',
      inputSchema: {
        urls: z
          .array(z.string())
          .min(1)
          .max(MAX_BULK_SIZE)
          .describe(`1-${MAX_BULK_SIZE} website URLs to scan.`),
      },
      outputSchema: {
        results: z.array(detectResultSchema).describe("One entry per requested URL, in the same order."),
        summary: z.object({
          total: z.number().int(),
          ok: z.number().int(),
          no_tech: z.number().int(),
          unreachable: z.number().int(),
          blocked: z.number().int(),
          invalid_input: z.number().int(),
        }),
      },
    },
    async ({ urls }) => {
      const output = await bulkDetectStack(urls, { userAgent });
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output,
      };
    }
  );

  return server;
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json());

// Health check endpoint (required for Cloud Run)
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy" });
});

// MCP endpoint with dev logging
app.post("/mcp", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const body = req.body;

  // Extract method and params from JSON-RPC request
  const method = body?.method || "unknown";
  const params = body?.params;

  // Log incoming request
  if (method === "tools/call") {
    const toolName = params?.name || "unknown";
    const toolArgs = params?.arguments;
    logRequest(`tools/call ${chalk.bold(toolName)}`, toolArgs);
  } else if (method !== "notifications/initialized") {
    logRequest(method, params);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // Capture response body for logging
  let responseBody = "";
  const originalWrite = res.write.bind(res) as typeof res.write;
  const originalEnd = res.end.bind(res) as typeof res.end;

  res.write = function (chunk: unknown, encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void), callback?: (error: Error | null | undefined) => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }
    return originalWrite(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.end = function (chunk?: unknown, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void) {
    if (chunk) {
      responseBody += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBuffer).toString();
    }

    // Log response
    if (method !== "notifications/initialized") {
      const latency = Date.now() - startTime;

      try {
        const rpcResponse = JSON.parse(responseBody) as { result?: unknown; error?: unknown };

        if (rpcResponse?.error) {
          logError(method, rpcResponse.error, latency);
        } else if (method === "tools/call") {
          const content = (rpcResponse?.result as { content?: Array<{ text?: string }> })?.content;
          const resultText = content?.[0]?.text;
          logResponse(method, resultText, latency);
        } else {
          logResponse(method, null, latency);
        }
      } catch {
        logResponse(method, null, latency);
      }
    }

    return originalEnd(chunk as string, encodingOrCallback as BufferEncoding, callback);
  };

  res.on("close", () => {
    transport.close();
  });

  // Fresh server instance per request (see createMcpServer above) — required for
  // stateless streamable-HTTP so a second connection never reuses a transport.
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// JSON error handler (Express defaults to HTML errors)
app.use((_err: unknown, _req: Request, res: Response, _next: Function) => {
  res.status(500).json({ error: "Internal server error" });
});

// ============================================================================
// Start Server
// ============================================================================

const port = parseInt(process.env.PORT || "8080");
const httpServer = app.listen(port, () => {
  console.log();
  console.log(chalk.bold("MCP Server running on"), chalk.cyan(`http://localhost:${port}`));
  console.log(`  ${chalk.gray("Health:")} http://localhost:${port}/health`);
  console.log(`  ${chalk.gray("MCP:")}    http://localhost:${port}/mcp`);

  if (isDev) {
    console.log();
    console.log(chalk.gray("─".repeat(50)));
    console.log();
  }
});

// Graceful shutdown for Cloud Run (SIGTERM before kill)
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  httpServer.close(() => {
    process.exit(0);
  });
});
