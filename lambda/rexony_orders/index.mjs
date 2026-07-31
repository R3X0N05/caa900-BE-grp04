import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import crypto from "crypto";

const db  = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({ region: "us-east-1" });
const sm  = new SecretsManagerClient({ region: "us-east-1" });
const TABLE = "Orders";
const H = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

let _secrets = null;
async function getSecrets() {
  if (_secrets) return _secrets;
  const resp = await sm.send(new GetSecretValueCommand({ SecretId: "rexony/backend" }));
  _secrets = JSON.parse(resp.SecretString);
  return _secrets;
}

function decodeJWT(event) {
  try {
    const token = (event.headers?.Authorization || event.headers?.authorization || "").replace("Bearer ", "");
    if (!token) return null;
    return JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  } catch { return null; }
}

export const handler = async (event) => {
  const method = event.httpMethod;
  const path   = event.resource;
  const id     = event.pathParameters?.id;
  const claims = event.requestContext?.authorizer?.claims || {};
  const userId = claims.sub;
  const body   = event.body ? JSON.parse(event.body) : {};

  try {
    if (method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Methods": "GET,PUT,DELETE,POST,OPTIONS"
        },
        body: ""
      };
    }

    const { FROM_EMAIL } = await getSecrets();

    if (method === "POST" && path === "/order/new") {
      const jwt = decodeJWT(event);
      const guestEmail = body.guestEmail || "";
      const orderUserId = jwt?.sub || "guest";
      const orderEmail  = jwt?.email || guestEmail;
      if (!orderEmail) return { statusCode: 400, headers: H, body: JSON.stringify({ message: "Email required" }) };
      const order = {
        orderId:       crypto.randomUUID(),
        userId:        orderUserId,
        userEmail:     orderEmail,
        shippingInfo:  body.shippingInfo,
        orderItems:    body.orderItems,
        itemsPrice:    body.itemsPrice,
        taxPrice:      body.taxPrice,
        shippingPrice: body.shippingPrice,
        totalPrice:    body.totalPrice,
        paymentInfo:   body.paymentInfo,
        status:        "Processing",
        createdAt:     new Date().toISOString(),
      };
      await db.send(new PutCommand({ TableName: TABLE, Item: order }));
      try {
        await ses.send(new SendEmailCommand({
          Source: FROM_EMAIL,
          Destination: { ToAddresses: [orderEmail] },
          Message: {
            Subject: { Data: `Your Rexony order has been placed!` },
            Body: { Text: { Data: `Hi,\n\nYour order #${order.orderId.slice(-10)} has been placed and is now being processed.\n\nTotal: $${body.totalPrice}\n\nThank you for shopping with Rexony!` } }
          }
        }));
      } catch (e) { console.error("SES:", e.message); }
      return { statusCode: 201, headers: H, body: JSON.stringify({ order }) };
    }

    if (method === "GET" && path === "/orders/me") {
      if (!userId) return { statusCode: 401, headers: H, body: JSON.stringify({ message: "Unauthorized" }) };
      const { Items } = await db.send(new QueryCommand({
        TableName: TABLE,
        IndexName: "userId-index",
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId },
      }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ orders: Items || [] }) };
    }

    if (method === "GET" && path === "/admin/orders") {
      const { Items } = await db.send(new ScanCommand({ TableName: TABLE }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ orders: Items || [] }) };
    }

    if (method === "PUT" && path === "/order/{id}/cancel") {
      const jwt = decodeJWT(event);
      if (!jwt) return { statusCode: 401, headers: H, body: JSON.stringify({ message: "Unauthorized" }) };
      const { Item: order } = await db.send(new GetCommand({ TableName: TABLE, Key: { orderId: id } }));
      if (!order) return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Order not found" }) };
      if (order.userId !== jwt.sub && order.userEmail !== jwt.email)
        return { statusCode: 403, headers: H, body: JSON.stringify({ message: "Forbidden" }) };
      if (order.status !== "Processing")
        return { statusCode: 400, headers: H, body: JSON.stringify({ message: "Only Processing orders can be cancelled" }) };
      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { orderId: id },
        UpdateExpression: "SET #s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": "Cancelled" }
      }));
      if (order.userEmail) {
        try {
          await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: [order.userEmail] },
            Message: {
              Subject: { Data: `Your Rexony order has been cancelled` },
              Body: { Text: { Data: `Hi,\n\nYour order #${id.slice(-10)} has been cancelled.\n\nThank you,\nRexony` } }
            }
          }));
        } catch (e) { console.error("SES:", e.message); }
      }
      return { statusCode: 200, headers: H, body: JSON.stringify({ message: "Order cancelled" }) };
    }

    if (method === "PUT" && path === "/admin/order/{id}") {
      const { Item: order } = await db.send(new GetCommand({ TableName: TABLE, Key: { orderId: id } }));
      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { orderId: id },
        UpdateExpression: "SET #s = :s",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":s": body.status },
      }));
      if (order?.userEmail) {
        try {
          await ses.send(new SendEmailCommand({
            Source: FROM_EMAIL,
            Destination: { ToAddresses: [order.userEmail] },
            Message: {
              Subject: { Data: `Your Rexony order status updated` },
              Body: { Text: { Data: `Hi,\n\nYour order #${id.slice(-10)} status has been updated to: ${body.status}.\n\nThank you for shopping with Rexony!` } }
            }
          }));
        } catch (e) { console.error("SES:", e.message); }
      }
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    if (method === "DELETE" && path === "/admin/order/{id}") {
      await db.send(new DeleteCommand({ TableName: TABLE, Key: { orderId: id } }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ success: true }) };
    }

    // ─── Contact form ───────────────────────────────────────────────────────────
    if (method === "POST" && path === "/contact") {
      const { name, email, subject, message } = body;
      if (!name || !email || !message) {
        return { statusCode: 400, headers: H, body: JSON.stringify({ message: "Missing required fields" }) };
      }
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [FROM_EMAIL] },
        Message: {
          Subject: { Data: `[Rexony Contact] ${subject || "No Subject"}` },
          Body: { Text: { Data: `From: ${name} <${email}>\n\n${message}` } }
        }
      }));
      return { statusCode: 200, headers: H, body: JSON.stringify({ message: "Message sent" }) };
    }
    // ───────────────────────────────────────────────────────────────────────────

    return { statusCode: 404, headers: H, body: JSON.stringify({ message: "Not found", method, path }) };

  } catch (err) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ message: err.message }) };
  }
};