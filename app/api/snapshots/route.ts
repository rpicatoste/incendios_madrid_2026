import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { defaultRegionData } from "../../../lib/region-data";
import { getCopernicusFireMap } from "../../../lib/copernicus-fire-map";
import {
  captureSatelliteSnapshot,
  freezeSatelliteSnapshot,
  type SatelliteSnapshot,
} from "../../../lib/satellite-snapshots";

type SnapshotPayload = {
  status: unknown;
  airStations: unknown[];
  region: unknown;
  layerTime: string;
  satellite?: SatelliteSnapshot;
};

type StoredSnapshot = {
  id: string;
  capturedAt: string;
  data: SnapshotPayload;
};

const dataDirectory =
  process.env.FOCO_DATA_DIR || join(process.cwd(), ".foco-data");
const snapshotFile = join(dataDirectory, "snapshots.json");
let writeQueue: Promise<unknown> = Promise.resolve();

const readSnapshots = async (): Promise<StoredSnapshot[]> => {
  try {
    return JSON.parse(await readFile(snapshotFile, "utf8")) as StoredSnapshot[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const saveSnapshots = async (snapshots: StoredSnapshot[]) => {
  await mkdir(dirname(snapshotFile), { recursive: true });
  const temporaryFile = `${snapshotFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(snapshots), "utf8");
  await rename(temporaryFile, snapshotFile);
};

const withWriteLock = async <T,>(operation: () => Promise<T>) => {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
};

export async function GET() {
  try {
    const snapshots = (await readSnapshots()).slice(-336);
    return Response.json(
      { snapshots },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { snapshots: [], error: error instanceof Error ? error.message : "No se pudo abrir el histórico." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

const captureFromServer = async (
  request: Request,
  capturedAt: string,
): Promise<SnapshotPayload> => {
  const origin = new URL(request.url).origin;
  const [statusResponse, airResponse, regionResponse, copernicusMap] = await Promise.all([
    fetch(`${origin}/api/status`, { cache: "no-store" }),
    fetch(`${origin}/api/air`, { cache: "no-store" }),
    fetch(`${origin}/api/region`, { cache: "no-store" }),
    getCopernicusFireMap(),
  ]);
  const [status, air, region] = await Promise.all([
    statusResponse.json(),
    airResponse.json(),
    regionResponse.ok ? regionResponse.json() : Promise.resolve(defaultRegionData),
  ]);
  return {
    status,
    airStations: (air as { stations?: unknown[] }).stations || [],
    region,
    layerTime: capturedAt,
    satellite: await captureSatelliteSnapshot("live", capturedAt, copernicusMap),
  };
};

export async function POST(request: Request) {
  try {
    const configuredToken = process.env.FOCO_SNAPSHOT_TOKEN || "";
    const providedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    const authorized =
      configuredToken.length >= 32 &&
      providedToken.length === configuredToken.length &&
      timingSafeEqual(Buffer.from(providedToken), Buffer.from(configuredToken));
    if (!authorized) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 128) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const rawBody = await request.text();
    if (rawBody.length > 128) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    const body = JSON.parse(rawBody || "{}") as { capture?: boolean };
    if (body.capture !== true) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }

    const capturedAt = new Date().toISOString();
    const hourId = capturedAt.slice(0, 13);
    const payload = await captureFromServer(request, capturedAt);

    const snapshot = await withWriteLock(async () => {
      const snapshots = await readSnapshots();
      const existingSnapshot = snapshots.find((item) => item.id === hourId);
      if (existingSnapshot?.data.satellite) return existingSnapshot;
      payload.satellite = await freezeSatelliteSnapshot(
        "live",
        hourId,
        payload.satellite!,
      );
      const newSnapshot: StoredSnapshot = {
        id: hourId,
        capturedAt,
        data: payload,
      };
      const existingIndex = snapshots.findIndex((item) => item.id === hourId);
      const nextSnapshots =
        existingIndex >= 0
          ? snapshots.map((item, index) => (index === existingIndex ? newSnapshot : item))
          : [...snapshots, newSnapshot];
      await saveSnapshots(nextSnapshots.slice(-336));
      return newSnapshot;
    });

    return Response.json({ snapshot });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo guardar el snapshot." },
      { status: 500 },
    );
  }
}
