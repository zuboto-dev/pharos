import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

// MCP over stdio for clients that launch Pharos themselves. Shares the same SQLite database as
// the HTTP server, so both can run at once. stdout is reserved for the protocol.
const store = new Store(openDatabase());
store.ensureDefaultViews();
await createMcpServer(store).connect(new StdioServerTransport());
