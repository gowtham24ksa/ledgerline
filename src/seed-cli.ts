// Usage: npm run build && npm run seed   (WIPES all data and re-seeds the demo workspace)
import { migrate, pool } from "./db.js";
import { seed, DEMO_USERNAME } from "./seed.js";
import { links } from "./services.js";

await migrate();
const c = await seed();
console.log(`Seeded ${c.name}. Login: ${DEMO_USERNAME}`);
console.log(`MCP connector URL: ${links.mcp(c)}`);
await pool.end();
