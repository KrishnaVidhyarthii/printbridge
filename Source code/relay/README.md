# The online drop page (remote printing)

Optional. Lets chosen people send a file to the office printers from anywhere
(see "Printing from anywhere" on the Printers & setup page). It runs as one
free Cloudflare Worker; the office's main computer collects the files, so
nothing reaches into the office.

## Setting it up (once)

1. In Cloudflare: **Workers & Pages > Create > Worker**, give it a name
   (for example `printbridge`) and deploy the starter code.
2. **Storage & Databases > KV > Create a namespace** (any name).
3. In the Worker: **Settings > Bindings > Add > KV namespace**. The variable
   name must be exactly **`PB`**, pointing at the namespace from step 2.
   Without it every request answers "This drop page isn't finished".
4. On a computer with this folder: `node build.js`. It writes
   `dist/worker.js` and prints a **pairing code**.
5. In the Worker: **Edit code**, replace everything with `dist/worker.js`,
   and **Deploy**.
6. On the main computer: **Printers & setup > Printing from anywhere**, type
   the Worker's address (`https://printbridge.<you>.workers.dev`) and the
   pairing code.

## Updating it

Run `node build.js THE-SAME-PAIRING-CODE` (keeps the code you already
have written down), then paste `dist/worker.js` into **Edit code** again and **Deploy**. The
people, their codes and waiting files are kept in KV.

Files wait (encrypted) in KV for up to 14 days. The free plan allows 1,000
KV writes a day for the whole account; each printout uses about 8.
