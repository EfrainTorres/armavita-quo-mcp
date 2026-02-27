// Copyright (C) 2025 ArmaVita LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://api.openphone.com/v1";
const API_KEY = process.env.QUO_API_KEY;
const SERVER_VERSION = "1.0.0";
const HTTP_TIMEOUT_MS = Number.parseInt(process.env.QUO_HTTP_TIMEOUT_MS ?? "30000", 10);

if (!API_KEY) {
  console.error("QUO_API_KEY environment variable is required");
  process.exit(1);
}

if (!Number.isFinite(HTTP_TIMEOUT_MS) || HTTP_TIMEOUT_MS < 1000) {
  console.error("QUO_HTTP_TIMEOUT_MS must be a number >= 1000");
  process.exit(1);
}

// --- API helper ---

function redactSecrets(value) {
  if (value === undefined || value === null) return value;
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text
    .replace(API_KEY, "***REDACTED_API_KEY***")
    .replace(/(Authorization["']?\s*:\s*["']?)[^"',\s}]+/gi, "$1***REDACTED***");
}

function extractErrorMessage(rawBody) {
  if (!rawBody) return "No response body";
  try {
    const parsed = JSON.parse(rawBody);
    if (typeof parsed?.message === "string" && parsed.message.trim()) return parsed.message;
    if (typeof parsed?.error?.message === "string" && parsed.error.message.trim()) return parsed.error.message;
    if (typeof parsed?.error === "string" && parsed.error.trim()) return parsed.error;
    return rawBody;
  } catch {
    return rawBody;
  }
}

function jsonToolResponse(payload, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function quoFetch(path, { method = "GET", body, params } = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        if (Array.isArray(v)) {
          v.forEach((item) => url.searchParams.append(k, item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: API_KEY,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      const detail = redactSecrets(extractErrorMessage(text));
      throw new Error(`Quo API ${res.status} ${res.statusText}: ${detail}`);
    }

    if (res.status === 204) return { success: true };
    return res.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Quo API request timed out after ${HTTP_TIMEOUT_MS}ms`);
    }
    throw new Error(redactSecrets(error?.message ?? String(error)));
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// --- MCP Server ---

const server = new McpServer({
  name: "armavita-quo-mcp",
  version: SERVER_VERSION,
});

// ==================== MESSAGES ====================

server.tool(
  "send_text",
  "Send an SMS text message from a Quo phone number to a recipient. Use E.164 format for phone numbers (e.g. +18325551234). The 'from' field can be a phone number ID (PN...) or E.164 number.",
  {
    from: z.string().describe("Phone number ID (PN...) or E.164 format sender number"),
    to: z.string().describe("Recipient phone number in E.164 format (e.g. +18325551234)"),
    content: z.string().min(1).max(1600).describe("Message text (1-1600 chars)"),
    setInboxStatus: z.enum(["done"]).optional().describe("Set to 'done' to move conversation to Done inbox"),
  },
  async ({ from, to, content, setInboxStatus }) => {
    const result = await quoFetch("/messages", {
      method: "POST",
      body: { from, to: [to], content, ...(setInboxStatus ? { setInboxStatus } : {}) },
    });
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "list_messages",
  "List messages for a specific phone number and conversation participant. Returns messages in chronological order with pagination.",
  {
    phoneNumberId: z.string().describe("Quo phone number ID (PN...)"),
    participants: z.array(z.string()).describe("Phone numbers of the other party in E.164 format"),
    maxResults: z.number().min(1).max(100).default(20).optional().describe("Max results per page (1-100, default 20)"),
    createdAfter: z.string().optional().describe("ISO 8601 datetime — only messages after this time"),
    createdBefore: z.string().optional().describe("ISO 8601 datetime — only messages before this time"),
    pageToken: z.string().optional().describe("Pagination token from previous response"),
  },
  async ({ phoneNumberId, participants, maxResults, createdAfter, createdBefore, pageToken }) => {
    const result = await quoFetch("/messages", {
      params: { phoneNumberId, participants, maxResults, createdAfter, createdBefore, pageToken },
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_message",
  "Get a specific message by its ID.",
  {
    id: z.string().describe("Message ID (AC...)"),
  },
  async ({ id }) => {
    const result = await quoFetch(`/messages/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

// ==================== CONVERSATIONS ====================

server.tool(
  "list_conversations",
  "List conversations, optionally filtered by phone number(s), user, or date range. Ordered by most recent activity.",
  {
    phoneNumbers: z.array(z.string()).optional().describe("Filter by Quo phone number IDs (PN...) or E.164 numbers"),
    userId: z.string().optional().describe("Filter by user ID (US...)"),
    createdAfter: z.string().optional().describe("ISO 8601 datetime"),
    createdBefore: z.string().optional().describe("ISO 8601 datetime"),
    updatedAfter: z.string().optional().describe("ISO 8601 datetime"),
    updatedBefore: z.string().optional().describe("ISO 8601 datetime"),
    excludeInactive: z.boolean().optional().describe("Exclude inactive conversations"),
    maxResults: z.number().min(1).max(100).default(20).optional().describe("Max results (1-100, default 20)"),
    pageToken: z.string().optional().describe("Pagination token"),
  },
  async ({ phoneNumbers, userId, createdAfter, createdBefore, updatedAfter, updatedBefore, excludeInactive, maxResults, pageToken }) => {
    const result = await quoFetch("/conversations", {
      params: { phoneNumbers, userId, createdAfter, createdBefore, updatedAfter, updatedBefore, excludeInactive, maxResults, pageToken },
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ==================== CONTACTS ====================

server.tool(
  "create_contact",
  "Create a new contact in the Quo workspace.",
  {
    firstName: z.string().describe("Contact first name"),
    lastName: z.string().optional().describe("Contact last name"),
    company: z.string().optional().describe("Company name"),
    role: z.string().optional().describe("Role/title"),
    phoneNumbers: z.array(z.object({
      name: z.string().default("primary"),
      value: z.string(),
    })).optional().describe("Phone numbers with labels"),
    emails: z.array(z.object({
      name: z.string().default("primary"),
      value: z.string(),
    })).optional().describe("Email addresses with labels"),
  },
  async ({ firstName, lastName, company, role, phoneNumbers, emails }) => {
    const result = await quoFetch("/contacts", {
      method: "POST",
      body: {
        defaultFields: {
          firstName,
          ...(lastName ? { lastName } : {}),
          ...(company ? { company } : {}),
          ...(role ? { role } : {}),
          ...(phoneNumbers ? { phoneNumbers } : {}),
          ...(emails ? { emails } : {}),
        },
      },
    });
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "list_contacts",
  "List contacts in the Quo workspace with optional filtering.",
  {
    maxResults: z.number().min(1).max(50).default(20).optional().describe("Max results (1-50, default 20)"),
    pageToken: z.string().optional().describe("Pagination token"),
    externalIds: z.array(z.string()).optional().describe("Filter by external IDs"),
  },
  async ({ maxResults, pageToken, externalIds }) => {
    const result = await quoFetch("/contacts", {
      params: { maxResults, pageToken, externalIds },
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_contact",
  "Get a specific contact by ID.",
  {
    id: z.string().describe("Contact ID"),
  },
  async ({ id }) => {
    const result = await quoFetch(`/contacts/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "update_contact",
  "Update an existing contact by ID.",
  {
    id: z.string().describe("Contact ID"),
    firstName: z.string().optional().describe("Updated first name"),
    lastName: z.string().optional().describe("Updated last name"),
    company: z.string().optional().describe("Updated company"),
    role: z.string().optional().describe("Updated role"),
    phoneNumbers: z.array(z.object({
      name: z.string(),
      value: z.string(),
      id: z.string().optional(),
    })).optional().describe("Updated phone numbers"),
    emails: z.array(z.object({
      name: z.string(),
      value: z.string(),
      id: z.string().optional(),
    })).optional().describe("Updated emails"),
  },
  async ({ id, firstName, lastName, company, role, phoneNumbers, emails }) => {
    const defaultFields = {};
    if (firstName !== undefined) defaultFields.firstName = firstName;
    if (lastName !== undefined) defaultFields.lastName = lastName;
    if (company !== undefined) defaultFields.company = company;
    if (role !== undefined) defaultFields.role = role;
    if (phoneNumbers !== undefined) defaultFields.phoneNumbers = phoneNumbers;
    if (emails !== undefined) defaultFields.emails = emails;
    if (Object.keys(defaultFields).length === 0) {
      return jsonToolResponse(
        {
          error: {
            message: "No fields provided for update_contact",
            details: "Pass at least one of: firstName, lastName, company, role, phoneNumbers, emails.",
          },
        },
        true
      );
    }

    const result = await quoFetch(`/contacts/${id}`, {
      method: "PATCH",
      body: { defaultFields },
    });
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "delete_contact",
  "Delete a contact by ID. THIS IS DESTRUCTIVE — use with caution.",
  {
    id: z.string().describe("Contact ID to delete"),
  },
  async ({ id }) => {
    await quoFetch(`/contacts/${id}`, { method: "DELETE" });
    return { content: [{ type: "text", text: `Contact ${id} deleted.` }] };
  }
);

// ==================== CALLS ====================

server.tool(
  "list_calls",
  "List calls for a specific phone number and participant.",
  {
    phoneNumberId: z.string().describe("Quo phone number ID (PN...)"),
    participants: z.array(z.string()).describe("Other party phone numbers in E.164 format"),
    maxResults: z.number().min(1).max(100).default(20).optional().describe("Max results (1-100, default 20)"),
    createdAfter: z.string().optional().describe("ISO 8601 datetime"),
    createdBefore: z.string().optional().describe("ISO 8601 datetime"),
    pageToken: z.string().optional().describe("Pagination token"),
  },
  async ({ phoneNumberId, participants, maxResults, createdAfter, createdBefore, pageToken }) => {
    const result = await quoFetch("/calls", {
      params: { phoneNumberId, participants, maxResults, createdAfter, createdBefore, pageToken },
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_call",
  "Get details of a specific call by ID, including duration, status, direction.",
  {
    callId: z.string().describe("Call ID (AC...)"),
  },
  async ({ callId }) => {
    const result = await quoFetch(`/calls/${callId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "get_call_recordings",
  "Get recordings for a specific call.",
  {
    callId: z.string().describe("Call ID (AC...)"),
  },
  async ({ callId }) => {
    const result = await quoFetch(`/call-recordings/${callId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "get_call_summary",
  "Get an AI-generated summary of a call (Business/Scale plans only).",
  {
    callId: z.string().describe("Call ID (AC...)"),
  },
  async ({ callId }) => {
    const result = await quoFetch(`/call-summaries/${callId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "get_call_transcription",
  "Get the transcription of a call (Business/Scale plans only).",
  {
    callId: z.string().describe("Call ID (AC...)"),
  },
  async ({ callId }) => {
    const result = await quoFetch(`/call-transcripts/${callId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "get_voicemail",
  "Get the voicemail for a call.",
  {
    callId: z.string().describe("Call ID (AC...)"),
  },
  async ({ callId }) => {
    const result = await quoFetch(`/call-voicemails/${callId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

// ==================== PHONE NUMBERS ====================

server.tool(
  "list_phone_numbers",
  "List all phone numbers in the Quo workspace, with their users and settings.",
  {
    userId: z.string().optional().describe("Filter by user ID (US...)"),
  },
  async ({ userId }) => {
    const result = await quoFetch("/phone-numbers", {
      params: userId ? { userId } : {},
    });
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "get_phone_number",
  "Get details of a specific phone number by ID, including users, restrictions, and forwarding settings.",
  {
    phoneNumberId: z.string().describe("Phone number ID (PN...)"),
  },
  async ({ phoneNumberId }) => {
    const result = await quoFetch(`/phone-numbers/${phoneNumberId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

// ==================== USERS ====================

server.tool(
  "list_users",
  "List all users in the Quo workspace.",
  {},
  async () => {
    const result = await quoFetch("/users");
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

server.tool(
  "get_user",
  "Get a specific user by ID, including their email, name, role, and picture.",
  {
    userId: z.string().describe("User ID (US...)"),
  },
  async ({ userId }) => {
    const result = await quoFetch(`/users/${userId}`);
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

// ==================== CONTACT CUSTOM FIELDS ====================

server.tool(
  "get_contact_custom_fields",
  "List all custom contact fields defined in the workspace (name, key, type). Useful for understanding what custom data is tracked on contacts.",
  {},
  async () => {
    const result = await quoFetch("/contact-custom-fields");
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

// ==================== WEBHOOKS ====================

server.tool(
  "list_webhooks",
  "List all configured webhooks.",
  {},
  async () => {
    const result = await quoFetch("/webhooks");
    return { content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }] };
  }
);

// --- Start server ---

try {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (error) {
  console.error(`Failed to start armavita-quo-mcp: ${redactSecrets(error?.message ?? String(error))}`);
  process.exit(1);
}
