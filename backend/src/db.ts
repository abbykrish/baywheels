import path from "path";
import { DuckDBInstance } from "@duckdb/node-api";

const DB_PATH =
  process.env.BAYWHEELS_DB ??
  path.resolve(import.meta.dirname, "..", "..", "data", "baywheels.duckdb");

let instance: DuckDBInstance | null = null;

export async function getConnection() {
  if (!instance) {
    instance = await DuckDBInstance.create(DB_PATH);
  }
  return instance.connect();
}

export { DB_PATH };
