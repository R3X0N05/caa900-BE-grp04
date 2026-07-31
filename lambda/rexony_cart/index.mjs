import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocumentClient.from(client);
const TABLE = "Cart";
const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const getUserId = (event) => {
  return event.requestContext?.authorizer?.claims?.sub
    || event.requestContext?.authorizer?.claims?.["cognito:username"]
    || "guest";
};

export const handler = async (event) => {
  const method = event.httpMethod;
  const path   = event.path;
  const userId = getUserId(event);
  const body   = event.body ? JSON.parse(event.body) : {};

  try {

    // GET /cart
    if (method === "GET" && path === "/cart") {
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ items: Item?.items || [] }) };
    }

    // POST /cart — add item
    if (method === "POST" && path === "/cart") {
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
      const items = Item?.items || [];
      const idx = items.findIndex(i => i.productId === body.productId);
      if (idx >= 0) {
        items[idx].quantity += body.quantity || 1;
      } else {
        items.push({
          productId: body.productId,
          name:      body.name,
          price:     body.price,
          image:     body.image || "",
          quantity:  body.quantity || 1,
          Stock:     body.Stock || 99
        });
      }
      await db.send(new PutCommand({ TableName: TABLE, Item: { userId, items } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ items }) };
    }

    // PUT /cart — update item quantity
    if (method === "PUT" && path === "/cart") {
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
      const items = Item?.items || [];
      const idx = items.findIndex(i => i.productId === body.productId);
      if (idx >= 0) {
        items[idx].quantity = body.quantity;
        if (items[idx].quantity <= 0) items.splice(idx, 1);
      }
      await db.send(new PutCommand({ TableName: TABLE, Item: { userId, items } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ items }) };
    }

    // DELETE /cart/clear
    if (method === "DELETE" && path === "/cart/clear") {
      await db.send(new PutCommand({ TableName: TABLE, Item: { userId, items: [] } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    // DELETE /cart/{productId}
    if (method === "DELETE" && path.startsWith("/cart/")) {
      const productId = event.pathParameters?.productId;
      const { Item } = await db.send(new GetCommand({ TableName: TABLE, Key: { userId } }));
      const items = (Item?.items || []).filter(i => i.productId !== productId);
      await db.send(new PutCommand({ TableName: TABLE, Item: { userId, items } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ items }) };
    }

    return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Not found", method, path }) };

  } catch (err) {
    console.error("ERROR:", err.message);
    return { statusCode: 500, headers: H, body: JSON.stringify({ message: err.message }) };
  }
};
