import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";

const MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN;

// Use MotherDuck if token is set, otherwise fall back to local file
const DB_PATH = MOTHERDUCK_TOKEN
  ? `md:baywheels?motherduck_token=${MOTHERDUCK_TOKEN}`
  : process.env.BAYWHEELS_DB ??
    path.resolve(import.meta.dirname, "..", "..", "data", "baywheels.duckdb");

let instance: DuckDBInstance | null = null;

export async function getConnection() {
  if (!instance) {
    instance = await DuckDBInstance.create(DB_PATH);
  }
  return instance.connect();
}

export { DB_PATH };
