import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { registerMcpTools } from './index';

describe('MCP tool registration', () => {
  it('exposes scoped Zod schemas and rejects invalid arguments', async () => {
    const server = new McpServer({ name: 'test-server', version: '1.0.0' });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    registerMcpTools(server, 'Bearer test', ['contacts:read', 'messages:send']);

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain('whoami');
      expect(names).toContain('list_contacts');
      expect(names).toContain('send_message');
      expect(names).not.toContain('create_contact');

      const sendMessage = tools.find((tool) => tool.name === 'send_message');
      expect(sendMessage?.inputSchema.required).toContain('to');
      expect(sendMessage?.inputSchema.properties?.type).toMatchObject({
        default: 'text',
      });

      const invalid = await client.callTool({
        name: 'list_contacts',
        arguments: { limit: 101 },
      });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
