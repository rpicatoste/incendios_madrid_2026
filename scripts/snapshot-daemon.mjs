const origin = process.env.FOCO_ORIGIN || "http://localhost:3000";
const token = process.env.FOCO_SNAPSHOT_TOKEN || "";
const intervalMs = 5 * 60 * 1000;

async function capture() {
  try {
    const response = await fetch(`${origin}/api/snapshots`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ capture: true }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    process.stdout.write(
      `[snapshots] ${result.snapshot?.capturedAt || "captura comprobada"}\n`,
    );
  } catch (error) {
    process.stderr.write(`[snapshots] esperando al servidor: ${error.message}\n`);
  }
}

await capture();
setInterval(capture, intervalMs);
