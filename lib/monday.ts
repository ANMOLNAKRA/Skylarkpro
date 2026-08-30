// monday.com GraphQL API client.
// Read-only. Discovers boards dynamically by name (no hardcoded board/column IDs),
// per assignment requirement: "Do not hardcode CSV data."

const MONDAY_API_URL = "https://api.monday.com/v2";

interface MondayColumn {
  id: string;
  title: string;
  type: string;
}

interface MondayColumnValue {
  id: string;
  text: string | null;
  column: { title: string; type: string };
}

interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

interface MondayBoard {
  id: string;
  name: string;
}

async function mondayQuery<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error("MONDAY_API_TOKEN is not set");
  }

  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`monday.com API error (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`monday.com GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

/** List all boards accessible to this token. Used to resolve board name -> id dynamically. */
export async function listBoards(): Promise<MondayBoard[]> {
  const data = await mondayQuery<{ boards: MondayBoard[] }>(`
    query {
      boards (limit: 50) {
        id
        name
      }
    }
  `);
  return data.boards;
}

/** Find a board id by fuzzy name match (case-insensitive substring, ignores spaces/underscores/hyphens). */
export async function findBoardId(nameHint: string): Promise<string | null> {
  const boards = await listBoards();
  const cleanHint = nameHint.toLowerCase().replace(/[\s_-]+/g, "");
  
  // Try direct match first
  let match = boards.find((b) =>
    b.name.toLowerCase().includes(nameHint.toLowerCase())
  );
  
  // Fallback to normalized fuzzy matching (stripping spaces, underscores, hyphens)
  if (!match) {
    match = boards.find((b) =>
      b.name.toLowerCase().replace(/[\s_-]+/g, "").includes(cleanHint)
    );
  }
  
  return match ? match.id : null;
}

/** Fetch all items (with column values) from a board, paginating through cursors. */
export async function getBoardItems(boardId: string): Promise<{
  columns: MondayColumn[];
  items: MondayItem[];
}> {
  const columnsData = await mondayQuery<{
    boards: { columns: MondayColumn[] }[];
  }>(
    `
    query ($boardId: [ID!]) {
      boards (ids: $boardId) {
        columns {
          id
          title
          type
        }
      }
    }
  `,
    { boardId: [boardId] }
  );

  const columns = columnsData.boards[0]?.columns ?? [];

  let items: MondayItem[] = [];
  let cursor: string | null = null;

  do {
    const data: {
      boards: {
        items_page: { cursor: string | null; items: MondayItem[] };
      }[];
    } = await mondayQuery(
      `
      query ($boardId: [ID!], $cursor: String) {
        boards (ids: $boardId) {
          items_page (limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values {
                id
                text
                column {
                  title
                  type
                }
              }
            }
          }
        }
      }
    `,
      { boardId: [boardId], cursor }
    );

    const page = data.boards[0]?.items_page;
    if (!page) break;
    items = items.concat(page.items);
    cursor = page.cursor;
  } while (cursor);

  return { columns, items };
}

export type { MondayBoard, MondayColumn, MondayColumnValue, MondayItem };
