/**
 * Bay Wheels trip data ingestion script.
 *
 * Downloads monthly CSV zip files from the S3 bucket and loads them into DuckDB.
 * Tracks which files have already been ingested to support incremental updates.
 *
 * Usage:
 *   npx tsx src/ingest.ts              # Ingest the most recent month
 *   npx tsx src/ingest.ts --recent 3   # Ingest only the 3 most recent months
 *   npx tsx src/ingest.ts --all        # Ingest all available files
 */

import fs from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { parseArgs } from "util";
import { DuckDBInstance } from "@duckdb/node-api";
import { DB_PATH } from "./db.js";
import yauzl from "yauzl";

const BUCKET_URL = "https://s3.amazonaws.com/baywheels-data";

const TARGET_COLUMNS = [
  "ride_id",
  "rideable_type",
  "started_at",
  "ended_at",
  "start_station_name",
  "start_station_id",
  "end_station_name",
  "end_station_id",
  "start_lat",
  "start_lng",
  "end_lat",
  "end_lng",
  "member_casual",
];

const COLUMN_ALIASES: Record<string, string | null> = {
  duration_sec: null,
  start_time: "started_at",
  end_time: "ended_at",
  start_station_latitude: "start_lat",
  start_station_longitude: "start_lng",
  end_station_latitude: "end_lat",
  end_station_longitude: "end_lng",
  bike_id: "ride_id",
  user_type: "member_casual",
  rental_access_method: null,
  bike_share_for_all_trip: null,
};

async function listAvailableFiles(): Promise<string[]> {
  const resp = await fetch(`${BUCKET_URL}/?list-type=2`);
  if (!resp.ok) throw new Error(`S3 list failed: ${resp.status}`);
  const text = await resp.text();

  const keys: string[] = [];
  const regex = /<Key>([^<]+\.zip)<\/Key>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    keys.push(match[1]);
  }
  return keys.sort();
}

async function getIngestedFiles(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>
): Promise<Set<string>> {
  try {
    const reader = await conn.runAndReadAll(
      "SELECT file_key FROM ingestion_log"
    );
    const rows = reader.getRowObjectsJson();
    return new Set(rows.map((r) => String(r.file_key)));
  } catch {
    return new Set();
  }
}

async function downloadAndExtractCsv(fileKey: string): Promise<string> {
  const url = `${BUCKET_URL}/${fileKey}`;
  console.log(`  Downloading ${url}...`);
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baywheels-"));
  const zipPath = path.join(tmpDir, "data.zip");

  const body = resp.body;
  if (!body) throw new Error("No response body");
  await pipeline(Readable.fromWeb(body as any), createWriteStream(zipPath));

  // Extract first CSV from zip using yauzl
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error("Failed to open zip"));

      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (/\.csv$/i.test(entry.fileName) && !entry.fileName.startsWith("__MACOSX")) {
          zipfile.openReadStream(entry, (err2, readStream) => {
            if (err2 || !readStream) return reject(err2 ?? new Error("Failed to read entry"));
            const csvPath = path.join(tmpDir, path.basename(entry.fileName));
            const ws = createWriteStream(csvPath);
            readStream.pipe(ws);
            ws.on("finish", () => {
              zipfile.close();
              fs.unlinkSync(zipPath);
              resolve(csvPath);
            });
            ws.on("error", reject);
          });
        } else {
          zipfile.readEntry();
        }
      });
      zipfile.on("end", () => {
        reject(new Error(`No CSV found in ${fileKey}`));
      });
      zipfile.on("error", reject);
    });
  });
}

async function loadCsvIntoDb(
  conn: Awaited<ReturnType<DuckDBInstance["connect"]>>,
  csvPath: string
) {
  const escaped = csvPath.replace(/'/g, "''");

  await conn.run(`
    CREATE OR REPLACE TEMPORARY TABLE staging AS
    SELECT * FROM read_csv_auto('${escaped}', header=true, ignore_errors=true)
  `);

  const reader = await conn.runAndReadAll("DESCRIBE staging");
  const cols = reader.getRowObjectsJson();
  const csvColumns = cols.map((c) =>
    String(c.column_name).toLowerCase().trim()
  );

  const selectExprs = TARGET_COLUMNS.map((target) => {
    if (csvColumns.includes(target)) return `"${target}"`;

    for (const [alias, mapped] of Object.entries(COLUMN_ALIASES)) {
      if (mapped === target && csvColumns.includes(alias)) {
        return `"${alias}" AS "${target}"`;
      }
    }
    return `NULL AS "${target}"`;
  });

  await conn.run(
    `INSERT INTO trips SELECT ${selectExprs.join(", ")} FROM staging`
  );
  await conn.run("DROP TABLE IF EXISTS staging");
}

async function ingest(recent?: number) {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  // Create tables if they don't exist
  await conn.run(`
    CREATE TABLE IF NOT EXISTS trips (
      ride_id VARCHAR PRIMARY KEY,
      rideable_type VARCHAR,
      started_at TIMESTAMP,
      ended_at TIMESTAMP,
      start_station_name VARCHAR,
      start_station_id VARCHAR,
      end_station_name VARCHAR,
      end_station_id VARCHAR,
      start_lat DOUBLE,
      start_lng DOUBLE,
      end_lat DOUBLE,
      end_lng DOUBLE,
      member_casual VARCHAR
    )
  `);
  await conn.run(`
    CREATE TABLE IF NOT EXISTS ingestion_log (
      file_key VARCHAR PRIMARY KEY,
      ingested_at TIMESTAMP DEFAULT current_timestamp
    )
  `);

  const allFiles = await listAvailableFiles();
  const alreadyIngested = await getIngestedFiles(conn);

  let pending = allFiles.filter((f) => !alreadyIngested.has(f));
  if (recent != null) {
    pending = pending.slice(-recent);
  }

  if (pending.length === 0) {
    console.log("All files already ingested. Nothing to do.");
    conn.closeSync();
    return;
  }

  console.log(`Found ${pending.length} file(s) to ingest:`);
  for (const f of pending) console.log(`  - ${f}`);

  for (const fileKey of pending) {
    console.log(`\nIngesting ${fileKey}...`);
    let csvPath: string | null = null;
    try {
      csvPath = await downloadAndExtractCsv(fileKey);
      await loadCsvIntoDb(conn, csvPath);
      await conn.run(
        `INSERT INTO ingestion_log (file_key) VALUES ('${fileKey.replace(/'/g, "''")}')`
      );
      console.log("  Done.");
    } catch (e) {
      console.error(`  ERROR ingesting ${fileKey}:`, e);
    } finally {
      if (csvPath && fs.existsSync(csvPath)) {
        fs.rmSync(path.dirname(csvPath), { recursive: true, force: true });
      }
    }
  }

  const reader = await conn.runAndReadAll("SELECT count(*) AS cnt FROM trips");
  const [row] = reader.getRowObjectsJson();
  console.log(`\nIngestion complete. Total trips in database: ${Number(row.cnt).toLocaleString()}`);
  conn.closeSync();
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    recent: { type: "string", short: "r" },
    all: { type: "boolean" },
  },
});

const recentN = values.all ? undefined : Number(values.recent ?? 1);
ingest(recentN).catch((e) => {
  console.error(e);
  process.exit(1);
});
