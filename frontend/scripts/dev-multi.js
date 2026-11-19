import { spawn } from "child_process";

const portals = [
  { name: "Customer Store", port: 5173 },
  { name: "Admin Portal  ", port: 5174 },
  { name: "Vendor Portal ", port: 5175 },
  { name: "Delivery Ops  ", port: 5176 },
];

console.log("Starting NexCart Multi-Portal Hosts...\n");

portals.forEach(({ name, port }) => {
  const proc = spawn("npx", ["vite", "--port", String(port), "--host"], {
    stdio: "inherit",
    shell: true,
  });

  proc.on("error", (err) => {
    console.error(`Failed to start ${name} on port ${port}:`, err);
  });
});