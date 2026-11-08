// Addresses and names this machine can be reached by on the local network. Used for the Host and
// Origin allow-lists when LAN_ACCESS=true (the API itself still listens on 127.0.0.1 only).
import os from 'node:os';

export function machineHosts(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal) continue;
      out.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
    }
  }
  const name = os.hostname().toLowerCase();
  if (name) {
    out.add(name);
    if (!name.includes('.')) out.add(`${name}.local`);
  }
  return [...out];
}

// The machine's addresses change when it joins another network (e.g. a phone hotspot), so the
// allow-list is re-read at most every 3 seconds instead of once at startup.
let cache: { at: number; hosts: Set<string> } | null = null;
export function currentMachineHosts(): Set<string> {
  const now = Date.now();
  if (!cache || now - cache.at > 3000) cache = { at: now, hosts: new Set(machineHosts()) };
  return cache.hosts;
}
