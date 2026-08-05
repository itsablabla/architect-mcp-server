import { z } from "zod";
import { larkRequest, type LarkTokenType } from "../core/lark.js";

/**
 * Lark / Feishu gateway actions, surfaced through the `lark` gateway tool.
 * Each handler returns a string (the registration loop wraps it as MCP content).
 *
 * Auth uses the Lark Open Platform client in core/lark.ts, which reads app
 * credentials from the secret store. Pass `token_type: "user"` on actions that
 * should run as the stored user access token instead of the tenant token.
 */

export interface LarkActionDefinition {
    name: string;
    description: string;
    schema: z.ZodType<any>;
    handler: (params: Record<string, any>) => Promise<string>;
}

const TOKEN_TYPE_DESC =
    "Access token to use: 'tenant' (default, app-level) or 'user' (stored LARK_USER_ACCESS_TOKEN).";

function withTokenType<T extends z.ZodRawShape>(shape: T) {
    return z.object({
        ...shape,
        token_type: z.enum(["tenant", "user"]).optional().describe(TOKEN_TYPE_DESC),
    });
}

function out(label: string, value: unknown): string {
    const json = JSON.stringify(value, null, 2);
    return `${label}:\n${json}`;
}

const DOC_TYPE = z.enum(["doc", "docx", "sheet", "bitable", "mindnote", "file", "slides", "wiki"]).describe(
    "Lark object type (drive file type). 'doc' is legacy Docs; 'docx' is the current Document type."
);

export const LARK_ACTION_DEFINITIONS: LarkActionDefinition[] = [

    // ───────────────────────── Docs (docx) ─────────────────────────

    {
        name: "lark_doc_create",
        description:
            "Create a new Lark Document (docx). Returns the document id. Requires a Lark app with docs:document scope.",
        schema: withTokenType({
            title: z.string().describe("Document title"),
            folder_token: z.string().optional().describe("Folder token to create the doc in (omit for root)"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: "/docx/v1/documents",
                body: { title: p.title, folder_token: p.folder_token },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Created document", data.document ?? data);
        },
    },
    {
        name: "lark_doc_get",
        description: "Get the plain-text content of a Lark Document (docx).",
        schema: withTokenType({
            document_id: z.string().describe("Document id"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/docx/v1/documents/${p.document_id}/raw_content`,
                tokenType: p.token_type as LarkTokenType,
            });
            return data.content ?? out("Document content", data);
        },
    },
    {
        name: "lark_doc_blocks",
        description: "List blocks of a Lark Document (docx), paginated.",
        schema: withTokenType({
            document_id: z.string().describe("Document id"),
            page_size: z.number().optional().describe("Max blocks per page (1-500, default 500)"),
            page_token: z.string().optional().describe("Pagination token from a previous response"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/docx/v1/documents/${p.document_id}/blocks`,
                query: { page_size: p.page_size, page_token: p.page_token },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Blocks", data);
        },
    },
    {
        name: "lark_doc_block_get",
        description: "Get a single block of a Lark Document (docx) by block id.",
        schema: withTokenType({
            document_id: z.string().describe("Document id"),
            block_id: z.string().describe("Block id"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/docx/v1/documents/${p.document_id}/blocks/${p.block_id}`,
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Block", data.block ?? data);
        },
    },
    {
        name: "lark_doc_append",
        description:
            "Append blocks to a Lark Document by creating children of a block (use the document id as block_id to append at the end). `children` is an array of Lark block objects, e.g. [{block_type:2, text:{elements:[{text_run:{content:\"Hello\"}}]}}].",
        schema: withTokenType({
            document_id: z.string().describe("Document id"),
            block_id: z.string().describe("Parent block id (use the document id to append at the end)"),
            children: z.array(z.record(z.string(), z.unknown())).min(1).describe("Block objects to insert"),
            index: z.number().optional().describe("Insert position (0-based); omit to append at the end"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/docx/v1/documents/${p.document_id}/blocks/${p.block_id}/children`,
                method: "POST",
                body: { children: p.children, index: p.index },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Appended blocks", data);
        },
    },
    {
        name: "lark_doc_update_text",
        description:
            "Update the text of a text block in a Lark Document. Replaces the block's text elements with the provided runs.",
        schema: withTokenType({
            document_id: z.string().describe("Document id"),
            block_id: z.string().describe("Block id of a text block"),
            elements: z.array(z.record(z.string(), z.unknown())).min(1).describe(
                "Text elements, e.g. [{text_run:{content:\"new text\"}}]"
            ),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/docx/v1/documents/${p.document_id}/blocks/${p.block_id}`,
                method: "PATCH",
                body: { update_text_elements: { elements: p.elements } },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Updated block", data.block ?? data);
        },
    },
    {
        name: "lark_doc_delete_blocks",
        description: "Delete a range of child blocks under a parent block in a Lark Document.",
        schema: withTokenType({
            document_id: z.string().describe("Document id"),
            block_id: z.string().describe("Parent block id"),
            start_index: z.number().describe("Start index of children to delete (0-based)"),
            end_index: z.number().describe("End index (exclusive)"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/docx/v1/documents/${p.document_id}/blocks/${p.block_id}/children/batch_delete`,
                method: "DELETE",
                body: { start_index: p.start_index, end_index: p.end_index },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Delete result", data);
        },
    },

    // ───────────────────────── Wiki ─────────────────────────

    {
        name: "lark_wiki_list_spaces",
        description: "List Lark Wiki spaces the authenticated app/user can access.",
        schema: withTokenType({
            page_size: z.number().optional().describe("Max spaces per page (1-50, default 20)"),
            page_token: z.string().optional().describe("Pagination token"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: "/wiki/v2/spaces",
                query: { page_size: p.page_size, page_token: p.page_token },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Wiki spaces", data);
        },
    },
    {
        name: "lark_wiki_list_nodes",
        description: "List nodes under a Lark Wiki space.",
        schema: withTokenType({
            space_id: z.string().describe("Wiki space id"),
            parent_node_token: z.string().optional().describe("Parent node token (omit for root-level nodes)"),
            page_size: z.number().optional().describe("Max nodes per page (1-50, default 20)"),
            page_token: z.string().optional().describe("Pagination token"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/wiki/v2/spaces/${p.space_id}/nodes`,
                query: {
                    parent_node_token: p.parent_node_token,
                    page_size: p.page_size,
                    page_token: p.page_token,
                },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Wiki nodes", data);
        },
    },
    {
        name: "lark_wiki_create_node",
        description:
            "Create a node in a Lark Wiki space. `obj_type` selects the embedded document type (docx, sheet, etc.). The new document is created automatically inside the space.",
        schema: withTokenType({
            space_id: z.string().describe("Wiki space id"),
            obj_type: DOC_TYPE.describe("Type of object to create in the wiki node"),
            parent_node_token: z.string().optional().describe("Parent node token (omit for root level)"),
            node_type: z.enum(["origin", "shortcut"]).optional().describe("origin creates the object; shortcut links one"),
            obj_token: z.string().optional().describe("Required when node_type is 'shortcut'"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/wiki/v2/spaces/${p.space_id}/nodes`,
                method: "POST",
                body: {
                    obj_type: p.obj_type,
                    parent_node_token: p.parent_node_token,
                    node_type: p.node_type,
                    obj_token: p.obj_token,
                },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Created wiki node", data.node ?? data);
        },
    },
    {
        name: "lark_wiki_get_node",
        description: "Get info for a Lark Wiki node by its token.",
        schema: withTokenType({
            token: z.string().describe("Wiki node token"),
            obj_type: DOC_TYPE.optional().describe("Object type of the node (helps resolve the right token)"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: "/wiki/v2/spaces/get_node",
                query: { token: p.token, obj_type: p.obj_type },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Wiki node", data.node ?? data);
        },
    },
    {
        name: "lark_wiki_move_node",
        description: "Move a Lark Wiki node to a different space and/or parent within/across wiki spaces.",
        schema: withTokenType({
            space_id: z.string().describe("Source wiki space id the node currently lives in"),
            node_token: z.string().describe("Wiki node token to move"),
            target_space_id: z.string().optional().describe("Destination wiki space id (omit to move within the same space)"),
            target_parent_token: z.string().optional().describe("Destination parent node token (omit for root)"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/wiki/v2/spaces/${p.space_id}/nodes/${p.node_token}/move`,
                method: "POST",
                body: { target_space_id: p.target_space_id, target_parent_token: p.target_parent_token },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Moved wiki node", data.node ?? data);
        },
    },

    // ───────────────────────── Sheets ─────────────────────────

    {
        name: "lark_sheet_create",
        description: "Create a new Lark Sheet (spreadsheet). Returns the spreadsheet token.",
        schema: withTokenType({
            title: z.string().describe("Spreadsheet title"),
            folder_token: z.string().optional().describe("Folder token to create in (omit for root)"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: "/sheets/v3/spreadsheets",
                method: "POST",
                body: { title: p.title, folder_token: p.folder_token },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Created spreadsheet", data.spreadsheet ?? data);
        },
    },
    {
        name: "lark_sheet_get",
        description: "Get a Lark Sheet's metadata and list of sub-sheets (tabs).",
        schema: withTokenType({
            spreadsheet_token: z.string().describe("Spreadsheet token"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/sheets/v3/spreadsheets/${p.spreadsheet_token}`,
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Spreadsheet", data.spreadsheet ?? data);
        },
    },
    {
        name: "lark_sheet_list_tabs",
        description: "List the sub-sheets (tabs) inside a Lark Sheet.",
        schema: withTokenType({
            spreadsheet_token: z.string().describe("Spreadsheet token"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/sheets/v3/spreadsheets/${p.spreadsheet_token}/sheets/query`,
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Tabs", data.sheets ?? data);
        },
    },
    {
        name: "lark_sheet_get_values",
        description:
            "Read values from a Lark Sheet range (e.g. 'Sheet1!A1:C10' or 'A1:C10'). Returns a 2D array of cells.",
        schema: withTokenType({
            spreadsheet_token: z.string().describe("Spreadsheet token"),
            range: z.string().describe("A1-style range, e.g. 'Sheet1!A1:C10'"),
            value_render_option: z.enum(["ToString", "Formatted", "Formula", "UnformattedValue"]).optional().describe(
                "How cell values are rendered"
            ),
            dateTime_render_option: z.enum(["FormattedString"]).optional(),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/sheets/v2/spreadsheets/${p.spreadsheet_token}/values/${encodeURIComponent(p.range)}`,
                query: {
                    valueRenderOption: p.value_render_option,
                    dateTimeRenderOption: p.dateTime_render_option,
                },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Range values", data);
        },
    },
    {
        name: "lark_sheet_set_values",
        description:
            "Write a 2D array of values into a Lark Sheet range. `values` is a row-major array (outer = rows, inner = cells).",
        schema: withTokenType({
            spreadsheet_token: z.string().describe("Spreadsheet token"),
            range: z.string().describe("Target range, e.g. 'Sheet1!A1:C3'"),
            values: z.array(z.array(z.unknown())).min(1).describe("2D array of cell values (row-major)"),
            value_render_option: z.enum(["ToString", "Formatted", "Formula", "UnformattedValue"]).optional(),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/sheets/v2/spreadsheets/${p.spreadsheet_token}/values`,
                method: "PUT",
                body: {
                    valueRange: {
                        range: p.range,
                        values: p.values,
                    },
                    valueRenderOption: p.value_render_option,
                },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Write result", data);
        },
    },
    {
        name: "lark_sheet_batch_get",
        description: "Read multiple ranges from a Lark Sheet in one call.",
        schema: withTokenType({
            spreadsheet_token: z.string().describe("Spreadsheet token"),
            ranges: z.array(z.string()).min(1).describe("A1-style ranges, e.g. ['Sheet1!A1:A5','Sheet1!B1:B5']"),
            value_render_option: z.enum(["ToString", "Formatted", "Formula", "UnformattedValue"]).optional(),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/sheets/v2/spreadsheets/${p.spreadsheet_token}/values_batch_get`,
                query: {
                    ranges: p.ranges.join(","),
                    valueRenderOption: p.value_render_option,
                },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Batch values", data);
        },
    },

    // ───────────────────────── Permissions / sharing ─────────────────────────

    {
        name: "lark_perm_list_members",
        description: "List members who have direct access to a Lark drive document.",
        schema: withTokenType({
            token: z.string().describe("Document token (doc id, sheet token, etc.)"),
            type: DOC_TYPE.describe("Document type the token refers to"),
            need_public: z.boolean().optional().describe("Include public sharing settings in the response"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/drive/v1/permissions/${p.token}/members`,
                query: { type: p.type, need_public: p.need_public },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Permission members", data);
        },
    },
    {
        name: "lark_perm_add_member",
        description: "Grant a user, group, or chat access to a Lark drive document.",
        schema: withTokenType({
            token: z.string().describe("Document token"),
            type: DOC_TYPE.describe("Document type the token refers to"),
            member_type: z.enum(["user", "group", "chat", "openid", "department"]).describe("Kind of member being added"),
            member_id: z.string().describe("Member id (user id, group id, chat id, etc.)"),
            perm: z.enum(["view", "edit", "full_access"]).describe("Permission level to grant"),
            notify: z.boolean().optional().describe("Notify the member via Lark"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/drive/v1/permissions/${p.token}/members`,
                method: "POST",
                query: { type: p.type, need_notification: p.notify },
                body: {
                    member_type: p.member_type,
                    member_id: p.member_id,
                    perm: p.perm,
                },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Added member", data);
        },
    },
    {
        name: "lark_perm_get_public",
        description: "Get the public sharing (link/org-wide) settings of a Lark drive document.",
        schema: withTokenType({
            token: z.string().describe("Document token"),
            type: DOC_TYPE.describe("Document type the token refers to"),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/drive/v2/permissions/${p.token}/public`,
                query: { type: p.type },
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Public sharing", data.public ?? data);
        },
    },
    {
        name: "lark_perm_update_public",
        description:
            "Update public sharing of a Lark drive document. Pass the Lark public-config fields you want to change (e.g. link_share_entity_map, external_access_entity_map, invite_external).",
        schema: withTokenType({
            token: z.string().describe("Document token"),
            type: DOC_TYPE.describe("Document type the token refers to"),
            fields: z.record(z.string(), z.unknown()).describe(
                "Lark public permission fields to patch, e.g. {link_share_entity_map:{tenant_readable:1}}"
            ),
        }),
        handler: async (p) => {
            const data: any = await larkRequest({
                path: `/drive/v2/permissions/${p.token}/public`,
                method: "PATCH",
                query: { type: p.type },
                body: p.fields,
                tokenType: p.token_type as LarkTokenType,
            });
            return out("Updated public sharing", data.public ?? data);
        },
    },
];

export const LARK_ACTION_NAMES = LARK_ACTION_DEFINITIONS.map(a => a.name);
