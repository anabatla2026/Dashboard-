import snowflake from "snowflake-sdk";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// Local dev has no Vercel-style injected env vars — load the root .env once,
// on first import, without overriding anything already set (e.g. in prod).
function loadLocalEnv() {
  if (process.env.SNOWFLAKE_ACCOUNT) return;
  const envPath = path.resolve(MODULE_DIR, "..", ".env");
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // malformed .env — treat as unconfigured, isSnowflakeConfigured() below will report it
    }
  }
}
loadLocalEnv();

export const SNOWFLAKE_DATABASE = process.env.SNOWFLAKE_DATABASE || "DWH";

export function isSnowflakeConfigured() {
  return Boolean(
    process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_USERNAME && process.env.SNOWFLAKE_PASSWORD
  );
}

let connectionPromise = null;

function connect() {
  if (connectionPromise) return connectionPromise;
  connectionPromise = new Promise((resolve, reject) => {
    const connection = snowflake.createConnection({
      account: process.env.SNOWFLAKE_ACCOUNT,
      username: process.env.SNOWFLAKE_USERNAME,
      password: process.env.SNOWFLAKE_PASSWORD,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      database: SNOWFLAKE_DATABASE,
    });
    connection.connect((err) => {
      if (err) {
        connectionPromise = null;
        reject(err);
        return;
      }
      resolve(connection);
    });
  });
  return connectionPromise;
}

function execute(connection, sqlText, binds) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err, stmt, rows) => (err ? reject(err) : resolve(rows)),
    });
  });
}

// One reconnect retry — covers an idle connection Snowflake has dropped
// server-side between requests (this runs in a long-lived Node process, not
// per-request like the Excel loader).
export async function query(sqlText, binds = []) {
  try {
    const connection = await connect();
    return await execute(connection, sqlText, binds);
  } catch (err) {
    if (err?.code === "ERR_CONNECTION_CLOSED" || /connection/i.test(err?.message || "")) {
      connectionPromise = null;
      const connection = await connect();
      return execute(connection, sqlText, binds);
    }
    throw err;
  }
}
